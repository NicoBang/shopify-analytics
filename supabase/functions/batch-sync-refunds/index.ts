import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthenticatedClient } from "../_shared/supabase.ts";
import { getShopifyToken } from "../_shared/shopify.ts";

/**
 * Batch Refunds Sync with Resume Capability
 *
 * Purpose: Handle large refund syncs by processing in small batches and saving progress
 * Strategy:
 * - Fetch up to 100 orders at a time
 * - Process them within 2-minute window
 * - Save progress (last_order_id) to database
 * - Can be called multiple times until complete
 *
 * This solves the timeout problem for days with 800+ orders
 */

interface BatchSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  jobId?: string;
  batchSize?: number; // Default: 50 orders per batch
  searchMode?: "created_at" | "updated_at"; // Default: updated_at (refund.created_at)
}

serve(async (req: Request): Promise<Response> => {
  try {
    const {
      shop,
      startDate,
      endDate,
      jobId,
      batchSize = 50,
      searchMode = "updated_at",
    }: BatchSyncRequest = await req.json();

    console.log(`🔄 Batch refunds sync: ${shop} ${startDate} → ${endDate}`);
    console.log(`   Mode: ${searchMode}, Batch size: ${batchSize}`);

    const supabase = createAuthenticatedClient();
    const shopifyToken = getShopifyToken(shop);

    // Get or create job
    let job: any;
    if (jobId) {
      const { data } = await supabase
        .from("bulk_sync_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      job = data;
    }

    if (!job) {
      // Create new job
      const { data: newJob } = await supabase
        .from("bulk_sync_jobs")
        .insert({
          shop,
          start_date: startDate,
          end_date: endDate,
          object_type: "refunds",
          status: "running",
          started_at: new Date().toISOString(),
          records_processed: 0,
          error_message: null,
        })
        .select()
        .single();
      job = newJob;
    } else {
      // Resume existing job
      await supabase
        .from("bulk_sync_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id);
    }

    // Get last processed order_id from error_message (we store progress there)
    let lastOrderId: string | null = null;
    if (job.error_message && job.error_message.startsWith("Progress:")) {
      lastOrderId = job.error_message.split("Progress: ")[1];
      console.log(`📍 Resuming from order ${lastOrderId}`);
    }

    // Fetch orders based on mode
    let orders: any[] = [];
    if (searchMode === "created_at") {
      // Legacy mode: orders created on this date
      let query = supabase
        .from("orders")
        .select("order_id, created_at")
        .eq("shop", shop)
        .gte("created_at", `${startDate}T00:00:00Z`)
        .lte("created_at", `${endDate}T23:59:59Z`)
        .order("order_id", { ascending: true })
        .limit(batchSize);

      if (lastOrderId) {
        query = query.gt("order_id", lastOrderId);
      }

      const { data, error } = await query;
      if (error) throw error;
      orders = data || [];
    } else {
      // New mode: fetch orders with refunds from Shopify API
      // Note: Shopify API uses updated_at for filtering, and we filter refunds by created_at
      const startISO = `${startDate}T00:00:00Z`;
      const endISO = `${endDate}T23:59:59Z`;

      // For pagination in updated_at mode, we need to track which orders we've processed
      // This is handled by the Shopify API's pagination, not by lastOrderId
      orders = await fetchOrdersWithRefundsBatch(shop, shopifyToken, startISO, endISO, batchSize, lastOrderId);
    }

    if (orders.length === 0) {
      console.log("✅ No more orders to process - sync complete");
      await supabase
        .from("bulk_sync_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id);

      return new Response(
        JSON.stringify({
          success: true,
          complete: true,
          message: "All orders processed",
          totalProcessed: job.records_processed || 0,
          jobId: job.id,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Processing ${orders.length} orders...`);

    // Process this batch
    let processed = 0;
    let withRefunds = 0;
    let errors = 0;

    for (const order of orders) {
      try {
        const orderId = order.order_id || order.id.toString().replace(/\D/g, "");

        // Fetch refunds
        const refundsUrl = `https://${shop}/admin/api/2024-10/orders/${orderId}/refunds.json`;
        const refundsResponse = await fetch(refundsUrl, {
          headers: {
            "X-Shopify-Access-Token": shopifyToken,
            "Content-Type": "application/json",
          },
        });

        if (!refundsResponse.ok) {
          console.error(`⚠️  Failed to fetch refunds for order ${orderId}: ${refundsResponse.status}`);
          errors++;
          continue;
        }

        const refundsData = await refundsResponse.json();
        const refunds = refundsData.refunds || [];

        if (refunds.length === 0) {
          processed++;
          continue;
        }

        // Process refunds
        let shippingRefund = 0;
        let refundDate: string | null = null;

        for (const refund of refunds) {
          if (!refundDate) {
            refundDate = refund.created_at;
          }

          // Parse order_adjustments for shipping refunds
          const orderAdjustments = refund.order_adjustments || [];
          for (const adj of orderAdjustments) {
            if (adj.kind === "shipping_refund") {
              const amount = Math.abs(parseFloat(adj.amount || "0"));
              shippingRefund += amount;
            }
          }
        }

        // Update orders table
        if (shippingRefund > 0 || refundDate) {
          const orderUpdate: any = {};
          if (shippingRefund > 0) orderUpdate.shipping_refund_dkk = shippingRefund;
          if (refundDate) orderUpdate.refund_date = refundDate;

          await supabase
            .from("orders")
            .update(orderUpdate)
            .eq("shop", shop)
            .eq("order_id", orderId);
        }

        // Update SKUs table
        const { data: skus, error: skusError } = await supabase
          .from("skus")
          .select("sku, quantity")
          .eq("shop", shop)
          .eq("order_id", orderId);

        if (!skusError && skus && skus.length > 0) {
          for (const sku of skus) {
            let refundedQty = 0;
            let refundedAmount = 0;

            for (const refund of refunds) {
              for (const item of refund.refund_line_items || []) {
                if (item.line_item?.sku === sku.sku) {
                  refundedQty += item.quantity || 0;
                  refundedAmount += parseFloat(item.subtotal || "0");
                }
              }
            }

            if (refundedQty > 0) {
              await supabase
                .from("skus")
                .update({
                  refunded_qty: refundedQty,
                  refunded_amount_dkk: refundedAmount,
                  refund_date: refundDate,
                })
                .eq("shop", shop)
                .eq("order_id", orderId)
                .eq("sku", sku.sku);
            }
          }
        }

        processed++;
        withRefunds++;

        // Save progress after each order
        lastOrderId = orderId;

        // Rate limiting: 500ms delay
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Error processing order:`, error);
        errors++;
      }
    }

    // Update job with progress
    const totalProcessed = (job.records_processed || 0) + processed;
    const hasMore = orders.length === batchSize;

    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: hasMore ? "pending" : "completed",
        records_processed: totalProcessed,
        completed_at: hasMore ? null : new Date().toISOString(),
        error_message: hasMore ? `Progress: ${lastOrderId}` : null,
      })
      .eq("id", job.id);

    console.log(`✅ Batch complete: ${processed} orders, ${withRefunds} with refunds, ${errors} errors`);
    console.log(`   Job ID: ${job.id}, Last order: ${lastOrderId}`);

    return new Response(
      JSON.stringify({
        success: true,
        complete: !hasMore,
        message: hasMore ? `Batch complete - more to process` : "All orders processed",
        batchProcessed: processed,
        ordersWithRefunds: withRefunds,
        totalProcessed,
        errors,
        jobId: job.id, // Return job ID for next iteration
        lastOrderId, // For debugging
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Batch sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function fetchOrdersWithRefundsBatch(
  shop: string,
  token: string,
  startISO: string,
  endISO: string,
  limit: number,
  lastOrderId: string | null = null
): Promise<any[]> {
  // In updated_at mode, we can't use lastOrderId for pagination directly
  // We need to fetch all orders and skip already-processed ones
  // This is less efficient but necessary for the API limitation
  const url = `https://${shop}/admin/api/2024-10/orders.json?updated_at_min=${startISO}&updated_at_max=${endISO}&status=any&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error(`❌ Failed to fetch orders: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = await res.json();
  const orders = json.orders || [];

  // Filter to only orders with refunds in date range
  const ordersWithRefunds = [];
  for (const order of orders) {
    const orderId = order.id.toString();

    // Skip orders we've already processed
    if (lastOrderId && orderId <= lastOrderId) {
      continue;
    }

    if (order.refunds && order.refunds.length > 0) {
      const refundsInRange = order.refunds.filter((refund: any) => {
        const refundCreated = new Date(refund.created_at);
        const start = new Date(startISO);
        const end = new Date(endISO);
        return refundCreated >= start && refundCreated <= end;
      });

      if (refundsInRange.length > 0) {
        ordersWithRefunds.push(order);
      }
    }
  }

  return ordersWithRefunds;
}
