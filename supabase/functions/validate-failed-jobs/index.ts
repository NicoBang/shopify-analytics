// Validate Failed Jobs
// Purpose: Check if failed jobs actually had orders in Shopify
// If no orders exist for that date, mark job as completed (not a real failure)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthenticatedClient } from "../_shared/supabase.ts";
import { getShopifyToken } from "../_shared/shopify.ts";

interface ValidationResult {
  shop: string;
  date: string;
  jobId: string;
  hadOrders: boolean;
  orderCount: number;
  updated: boolean;
}

serve(async (req) => {
  try {
    const { objectType = "orders" } = await req.json().catch(() => ({}));

    console.log(`🔍 Validating failed ${objectType} jobs...`);

    const supabase = createAuthenticatedClient();

    // Get all failed jobs
    const { data: failedJobs, error: fetchError } = await supabase
      .from("bulk_sync_jobs")
      .select("id, shop, start_date, object_type, records_processed")
      .eq("status", "failed")
      .eq("object_type", objectType)
      .order("shop", { ascending: true })
      .order("start_date", { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch jobs: ${fetchError.message}`);
    }

    if (!failedJobs || failedJobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No failed jobs found",
          validated: 0
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${failedJobs.length} failed jobs to validate`);

    const results: ValidationResult[] = [];

    // Validate each job
    for (const job of failedJobs) {
      try {
        const shopifyToken = getShopifyToken(job.shop);
        const date = job.start_date.split('T')[0]; // Get YYYY-MM-DD

        // Check Shopify based on object type
        let count = 0;
        let hasData = false;

        if (objectType === "orders") {
          count = await getOrderCountForDate(job.shop, shopifyToken, date);
          hasData = count > 0;
          console.log(`  ${job.shop} ${date}: ${count} orders in Shopify`);
        } else if (objectType === "skus") {
          // SKUs come from orders, so check if there were orders
          count = await getOrderCountForDate(job.shop, shopifyToken, date);
          hasData = count > 0;
          console.log(`  ${job.shop} ${date}: ${count} orders (SKU source) in Shopify`);
        } else if (objectType === "refunds") {
          // Check if there were any refunds on this date
          count = await getRefundCountForDate(job.shop, shopifyToken, date);
          hasData = count > 0;
          console.log(`  ${job.shop} ${date}: ${count} refunds in Shopify`);
        } else if (objectType === "shipping-discounts") {
          // Shipping discounts come from orders with shipping > 0
          count = await getOrderCountForDate(job.shop, shopifyToken, date);
          hasData = count > 0;
          console.log(`  ${job.shop} ${date}: ${count} orders (shipping discount source) in Shopify`);
        } else if (objectType === "fulfillments") {
          // Fulfillments come from orders, so check if there were orders
          count = await getOrderCountForDate(job.shop, shopifyToken, date);
          hasData = count > 0;
          console.log(`  ${job.shop} ${date}: ${count} orders (fulfillment source) in Shopify`);
        }

        const result: ValidationResult = {
          shop: job.shop,
          date,
          jobId: job.id,
          hadOrders: hasData,
          orderCount: count,
          updated: false,
        };

        // If no data in Shopify, mark job as completed (not a real failure)
        if (!hasData) {
          const { error: updateError } = await supabase
            .from("bulk_sync_jobs")
            .update({
              status: "completed",
              error_message: "Validated: No orders on this date (auto-corrected from failed)",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          if (updateError) {
            console.error(`❌ Failed to update job ${job.id}:`, updateError);
          } else {
            result.updated = true;
            console.log(`  ✅ Marked as completed (empty day)`);
          }
        } else {
          console.log(`  ⚠️ Real failure - had ${orderCount} orders`);
        }

        results.push(result);

        // Rate limiting: 2 requests per second (Shopify limit)
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Error validating ${job.shop} ${job.start_date}:`, error);
        results.push({
          shop: job.shop,
          date: job.start_date,
          jobId: job.id,
          hadOrders: false,
          orderCount: -1,
          updated: false,
        });
      }
    }

    const emptyDays = results.filter(r => !r.hadOrders && r.orderCount >= 0);
    const realFailures = results.filter(r => r.hadOrders);
    const updated = results.filter(r => r.updated);

    console.log(`\n📊 Validation Summary:`);
    console.log(`  Total validated: ${results.length}`);
    console.log(`  Empty days (not real failures): ${emptyDays.length}`);
    console.log(`  Real failures: ${realFailures.length}`);
    console.log(`  Updated to completed: ${updated.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total: results.length,
          emptyDays: emptyDays.length,
          realFailures: realFailures.length,
          updated: updated.length,
        },
        results,
        realFailures: realFailures.map(r => ({
          shop: r.shop,
          date: r.date,
          orderCount: r.orderCount,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function getOrderCountForDate(
  shop: string,
  token: string,
  date: string
): Promise<number> {
  const startDate = `${date}T00:00:00Z`;
  const endDate = `${date}T23:59:59Z`;

  const url = `https://${shop}/admin/api/2024-10/orders/count.json?created_at_min=${startDate}&created_at_max=${endDate}&status=any`;

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.count || 0;
}

async function getRefundCountForDate(
  shop: string,
  token: string,
  date: string
): Promise<number> {
  // Refunds are created on orders, so we need to:
  // 1. Get all orders (with any creation date)
  // 2. Check which ones have refunds created on the target date

  // Since there's no direct refund count API, we'll use a date range query
  // to get orders and check their refunds
  const startDate = `${date}T00:00:00Z`;
  const endDate = `${date}T23:59:59Z`;

  // Get orders with refunds (updated_at filter catches orders with refunds on this date)
  const url = `https://${shop}/admin/api/2024-10/orders.json?updated_at_min=${startDate}&updated_at_max=${endDate}&status=any&limit=250`;

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const orders = data.orders || [];

  // Count orders that have refunds created on the target date
  let refundCount = 0;
  for (const order of orders) {
    if (order.refunds && order.refunds.length > 0) {
      const refundsOnDate = order.refunds.filter((refund: any) => {
        const refundDate = refund.created_at?.split('T')[0];
        return refundDate === date;
      });
      if (refundsOnDate.length > 0) {
        refundCount++;
      }
    }
  }

  return refundCount;
}
