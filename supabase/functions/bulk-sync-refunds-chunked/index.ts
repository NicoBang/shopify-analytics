import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthenticatedClient } from "../_shared/supabase.ts";
import { getShopifyToken } from "../_shared/shopify.ts";

/**
 * Chunked Refunds Sync
 *
 * Handles large refund sync jobs by splitting them into smaller chunks
 * based on order count to avoid timeouts.
 *
 * Strategy:
 * - Check order count for the date range
 * - If > 300 orders: Split into chunks of max 100 orders each
 * - Process each chunk sequentially
 * - Update database with refund data incrementally
 */

interface ChunkedSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  chunkSize?: number; // Default: 100 orders per chunk
  maxOrders?: number; // Default: 300 (threshold for chunking)
}

serve(async (req: Request): Promise<Response> => {
  try {
    const {
      shop,
      startDate,
      endDate,
      chunkSize = 100,
      maxOrders = 300,
    }: ChunkedSyncRequest = await req.json();

    console.log(`🔄 Chunked refunds sync: ${shop} ${startDate} → ${endDate}`);

    const supabase = createAuthenticatedClient();
    const shopifyToken = getShopifyToken(shop);

    // Get all orders for the date range
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("order_id, created_at")
      .eq("shop", shop)
      .gte("created_at", `${startDate}T00:00:00Z`)
      .lte("created_at", `${endDate}T23:59:59Z`)
      .order("created_at", { ascending: true });

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    if (!orders || orders.length === 0) {
      console.log("✅ No orders found - nothing to sync");
      return new Response(
        JSON.stringify({ success: true, message: "No orders to process" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${orders.length} orders`);

    // Check if chunking is needed
    const needsChunking = orders.length > maxOrders;
    const chunks: typeof orders[] = [];

    if (needsChunking) {
      console.log(`⚠️  Large job detected (${orders.length} orders) - splitting into chunks of ${chunkSize}`);

      // Split into chunks
      for (let i = 0; i < orders.length; i += chunkSize) {
        chunks.push(orders.slice(i, i + chunkSize));
      }

      console.log(`📦 Created ${chunks.length} chunks`);
    } else {
      // Process all at once
      chunks.push(orders);
      console.log(`✅ Small job (${orders.length} orders) - processing as single batch`);
    }

    // Process each chunk
    let totalProcessed = 0;
    let totalWithRefunds = 0;
    let totalErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`\n🔄 Processing chunk ${i + 1}/${chunks.length} (${chunk.length} orders)...`);

      const chunkResults = await processChunk(shop, shopifyToken, chunk, supabase);

      totalProcessed += chunkResults.processed;
      totalWithRefunds += chunkResults.withRefunds;
      totalErrors += chunkResults.errors;

      console.log(`✅ Chunk ${i + 1} complete: ${chunkResults.withRefunds} orders with refunds`);

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n✅ Chunked sync complete!`);
    console.log(`  Total orders processed: ${totalProcessed}`);
    console.log(`  Orders with refunds: ${totalWithRefunds}`);
    console.log(`  Errors: ${totalErrors}`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          totalOrders: orders.length,
          chunksProcessed: chunks.length,
          ordersProcessed: totalProcessed,
          ordersWithRefunds: totalWithRefunds,
          errors: totalErrors,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Chunked sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function processChunk(
  shop: string,
  token: string,
  orders: Array<{ order_id: string; created_at: string }>,
  supabase: any
): Promise<{ processed: number; withRefunds: number; errors: number }> {
  let processed = 0;
  let withRefunds = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      // Fetch refunds for this order
      const refundsUrl = `https://${shop}/admin/api/2024-10/orders/${order.order_id}/refunds.json`;
      const refundsResponse = await fetch(refundsUrl, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      });

      if (!refundsResponse.ok) {
        console.error(`⚠️  Failed to fetch refunds for order ${order.order_id}: ${refundsResponse.status}`);
        errors++;
        continue;
      }

      const refundsData = await refundsResponse.json();
      const refunds = refundsData.refunds || [];

      if (refunds.length === 0) {
        processed++;
        continue;
      }

      // Process refunds for this order
      let totalRefunded = 0;
      let totalCancelled = 0;
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

        // Parse refund line items
        for (const item of refund.refund_line_items || []) {
          const qty = item.quantity || 0;
          const subtotal = parseFloat(item.subtotal || "0");

          totalRefunded += subtotal;
        }
      }

      // Update orders table with shipping refund
      if (shippingRefund > 0 || refundDate) {
        const orderUpdate: any = {};
        if (shippingRefund > 0) orderUpdate.shipping_refund_dkk = shippingRefund;
        if (refundDate) orderUpdate.refund_date = refundDate;

        await supabase
          .from("orders")
          .update(orderUpdate)
          .eq("shop", shop)
          .eq("order_id", order.order_id);
      }

      // Update SKUs table with refund data
      const { data: skus, error: skusError } = await supabase
        .from("skus")
        .select("sku, quantity")
        .eq("shop", shop)
        .eq("order_id", order.order_id);

      if (!skusError && skus && skus.length > 0) {
        for (const sku of skus) {
          // Find refund data for this SKU
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
              .eq("order_id", order.order_id)
              .eq("sku", sku.sku);
          }
        }
      }

      processed++;
      withRefunds++;

      // Rate limiting: 500ms delay
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`❌ Error processing order ${order.order_id}:`, error);
      errors++;
    }
  }

  return { processed, withRefunds, errors };
}
