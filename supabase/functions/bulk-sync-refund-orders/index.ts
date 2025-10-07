// Shopify Bulk Operations Edge Sync - REFUND ORDERS
// Syncs orders that have refunds in the date range (uses updated_at filter)
// This catches orders created earlier but refunded during the specified period

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPIFY_API_VERSION = "2024-10";
const POLL_INTERVAL_MS = 10000; // 10 seconds
const BATCH_SIZE = 500;
const MAX_POLL_ATTEMPTS = 360; // 1 hour max (360 * 10s)
const MAX_RETRIES = 3; // Max retries per day on errors
const EDGE_FUNCTION_TIMEOUT_MS = 300000; // 5 minutes (Edge Functions have ~6-7 min hard limit)

// Currency conversion rates (DKK base)
const CURRENCY_RATES: Record<string, number> = {
  DKK: 1.0,
  EUR: 7.46,
  CHF: 6.84,
};

interface BulkSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  objectType?: "orders" | "skus" | "both";
}

interface ShopifyBulkOperation {
  id: string;
  status: string;
  errorCode?: string;
  url?: string;
  objectCount?: number;
  fileSize?: number;
}

interface DayResult {
  day: string;
  status: "success" | "failed" | "skipped";
  ordersProcessed: number;
  skusProcessed: number;
  durationMs: number;
  error?: string;
}

serve(async (req) => {
  try {
    // Parse request
    const { shop, startDate, endDate, objectType = "both" }: BulkSyncRequest = await req.json();

    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop, startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });

    // Get Shopify access token
    const shopifyToken = getShopifyToken(shop);
    if (!shopifyToken) {
      return new Response(
        JSON.stringify({ error: `No access token found for shop: ${shop}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from("bulk_sync_jobs")
      .insert({
        shop,
        start_date: startDate,
        end_date: endDate,
        object_type: objectType,
        status: "pending",
      })
      .select()
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    console.log(`📋 Created job ${job.id} for ${shop} (${startDate} to ${endDate})`);

    // Start multi-day processing
    await supabase
      .from("bulk_sync_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    const startTime = Date.now();
    const days = generateDailyIntervals(startDate, endDate);
    const dayResults: DayResult[] = [];

    console.log(`📅 Processing ${days.length} day(s) from ${startDate} to ${endDate}`);
    console.log(`   Strategy: Fetch data first, then cleanup only orders returned by Shopify`);

    let totalOrders = 0;
    let totalSkus = 0;

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const dayStart = Date.now();

      // Check if we're approaching Edge Function timeout
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > EDGE_FUNCTION_TIMEOUT_MS) {
        console.log(`⚠️ Approaching Edge Function timeout (${elapsedMs}ms elapsed). Stopping gracefully.`);

        // Mark job as failed with timeout
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "failed",
            error_message: `Edge Function timeout after processing ${i}/${days.length} days`,
            completed_at: new Date().toISOString(),
            records_processed: totalOrders,
          })
          .eq("id", job.id);

        return new Response(
          JSON.stringify({
            success: false,
            error: "Edge Function timeout",
            daysProcessed: i,
            totalDays: days.length,
            ordersProcessed: totalOrders,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`\n🔄 Day ${i + 1}/${days.length}: ${day.date} (${day.startISO} to ${day.endISO})`);

      const dayResult = await processSingleDay(
        shop,
        shopifyToken,
        day.startISO,
        day.endISO,
        supabase,
        job.id,
        day.date
      );

      dayResults.push(dayResult);

      if (dayResult.status === "success") {
        totalOrders += dayResult.ordersProcessed;
        totalSkus += dayResult.skusProcessed;
        const dayDuration = (dayResult.durationMs / 1000).toFixed(1);
        console.log(`✅ Day completed: ${day.date} (${dayResult.ordersProcessed} orders, ${dayDuration}s)`);
      } else if (dayResult.status === "skipped") {
        console.log(`⏭️  Day skipped: ${day.date} - ${dayResult.error}`);
      } else {
        console.log(`❌ Day failed: ${day.date} - ${dayResult.error}`);
      }
    }

    // Mark job complete
    const totalDuration = Date.now() - startTime;
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "completed",
        orders_synced: totalOrders,
        skus_synced: totalSkus,
        records_processed: totalOrders + totalSkus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    const successfulDays = dayResults.filter((r) => r.status === "success").length;
    const failedDays = dayResults.filter((r) => r.status === "failed").length;
    const skippedDays = dayResults.filter((r) => r.status === "skipped").length;

    console.log(`\n🟡 Summary: ${totalOrders} orders synced in ${successfulDays} days, ${(totalDuration / 1000).toFixed(0)}s total`);
    console.log(`   ✅ Successful: ${successfulDays} | ❌ Failed: ${failedDays} | ⏭️  Skipped: ${skippedDays}`);

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        status: "completed",
        totalDays: days.length,
        successfulDays,
        failedDays,
        skippedDays,
        ordersProcessed: totalOrders,
        skusProcessed: totalSkus,
        recordsProcessed: totalOrders + totalSkus,
        durationSec: Math.round(totalDuration / 1000),
        dayResults,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Error:", error.message);

    // Try to update job status
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      });

      // Find most recent pending/running job
      const { data: jobs } = await supabase
        .from("bulk_sync_jobs")
        .select("id")
        .in("status", ["pending", "running", "polling", "downloading", "processing"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (jobs && jobs.length > 0) {
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "failed",
            error_message: error.message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobs[0].id);
      }
    } catch (updateError) {
      console.error("Failed to update job status:", updateError);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function getShopifyToken(shop: string): string | null {
  const shopMap: Record<string, string> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA")!,
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE")!,
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL")!,
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT")!,
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF")!,
  };
  return shopMap[shop] || null;
}

function generateDailyIntervals(startDate: string, endDate: string): Array<{ date: string; startISO: string; endISO: string }> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days: Array<{ date: string; startISO: string; endISO: string }> = [];

  let current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const startISO = `${dateStr}T00:00:00Z`;
    const endISO = `${dateStr}T23:59:59Z`;

    days.push({ date: dateStr, startISO, endISO });

    current.setDate(current.getDate() + 1);
  }

  return days;
}

async function processSingleDay(
  shop: string,
  token: string,
  startISO: string,
  endISO: string,
  supabase: any,
  jobId: string,
  day: string
): Promise<DayResult> {
  const dayStart = Date.now();
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      // Start bulk operation for this day
      const bulkOp = await startBulkOperation(shop, token, startISO, endISO);

      await supabase
        .from("bulk_sync_jobs")
        .update({
          bulk_operation_id: bulkOp.id,
          status: "polling",
          day: day
        })
        .eq("id", jobId);

      // Poll for completion
      const completedOp = await pollBulkOperation(shop, token, bulkOp.id, jobId, supabase);

      if (completedOp.status === "FAILED") {
        const errorCode = completedOp.errorCode || "UNKNOWN";

        // Retry on throttling or transient errors
        if (errorCode === "THROTTLED" || errorCode === "INTERNAL_SERVER_ERROR") {
          retries++;
          console.log(`⚠️  Day ${day} failed with ${errorCode}, retry ${retries}/${MAX_RETRIES}...`);
          await new Promise((resolve) => setTimeout(resolve, 5000 * retries)); // Exponential backoff
          continue;
        }

        // Non-retryable error
        return {
          day,
          status: "failed",
          ordersProcessed: 0,
          skusProcessed: 0,
          durationMs: Date.now() - dayStart,
          error: `Bulk operation failed: ${errorCode}`,
        };
      }

      // Download and process
      await supabase
        .from("bulk_sync_jobs")
        .update({
          status: "processing",
          file_url: completedOp.url,
          file_size_bytes: completedOp.fileSize
        })
        .eq("id", jobId);

      const { ordersProcessed, skusProcessed } = await processJSONL(
        completedOp.url!,
        shop,
        supabase,
        jobId
      );

      return {
        day,
        status: "success",
        ordersProcessed,
        skusProcessed,
        durationMs: Date.now() - dayStart,
      };

    } catch (error: any) {
      retries++;
      console.log(`⚠️  Day ${day} error: ${error.message}, retry ${retries}/${MAX_RETRIES}...`);

      if (retries >= MAX_RETRIES) {
        return {
          day,
          status: "failed",
          ordersProcessed: 0,
          skusProcessed: 0,
          durationMs: Date.now() - dayStart,
          error: error.message,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 5000 * retries));
    }
  }

  // Should never reach here
  return {
    day,
    status: "failed",
    ordersProcessed: 0,
    skusProcessed: 0,
    durationMs: Date.now() - dayStart,
    error: "Max retries exceeded",
  };
}

async function startBulkOperation(
  shop: string,
  token: string,
  startDate: string,
  endDate: string
): Promise<ShopifyBulkOperation> {
  // Query for orders with refunds (updated_at captures refund activity)
  // This catches orders created earlier but refunded in the date range
  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(query: "updated_at:>=${startDate} updated_at:<=${endDate}") {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                cancelledAt
                shippingAddress {
                  countryCode
                }
                currentTotalPriceSet {
                  shopMoney { amount currencyCode }
                }
                originalTotalPriceSet {
                  shopMoney { amount currencyCode }
                }
                subtotalPriceSet {
                  shopMoney { amount currencyCode }
                }
                totalDiscountsSet {
                  shopMoney { amount currencyCode }
                }
                totalTaxSet {
                  shopMoney { amount currencyCode }
                }
                shippingLine {
                  discountedPriceSet {
                    shopMoney { amount currencyCode }
                  }
                  originalPriceSet {
                    shopMoney { amount currencyCode }
                  }
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                      sku
                      name
                      variantTitle
                      quantity
                      originalUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                      discountedUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                    }
                  }
                }
                refunds(first: 250) {
                  id
                  createdAt
                }
              }
            }
          }
        }
        """
      ) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    throw new Error(`User errors: ${JSON.stringify(result.data.bulkOperationRunQuery.userErrors)}`);
  }

  return result.data.bulkOperationRunQuery.bulkOperation;
}

async function pollBulkOperation(
  shop: string,
  token: string,
  operationId: string,
  jobId: string,
  supabase: any
): Promise<ShopifyBulkOperation> {
  const query = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        url
        objectCount
        fileSize
      }
    }
  `;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();
    const operation: ShopifyBulkOperation = result.data?.currentBulkOperation;

    if (!operation) {
      throw new Error("No current bulk operation found");
    }

    console.log(`📊 Poll #${attempt + 1}: ${operation.status} (${operation.objectCount || 0} objects)`);

    if (operation.status === "COMPLETED" || operation.status === "FAILED") {
      return operation;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Polling timeout: operation did not complete within maximum attempts");
}

async function processJSONL(
  url: string,
  shop: string,
  supabase: any,
  jobId: string
): Promise<{ ordersProcessed: number; skusProcessed: number }> {
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.split("\n").filter((line) => line.trim());

  console.log(`📄 Processing ${lines.length} JSONL lines...`);

  const ordersBatch: any[] = [];
  const skusBatch: any[] = [];
  const orderRefunds: Map<string, any> = new Map();
  const orderMetadataMap: Map<string, any> = new Map(); // Store order data for lineItems
  const orderIds: string[] = []; // Track all order IDs for cleanup

  let ordersProcessed = 0;
  let skusProcessed = 0;

  // FIRST PASS: Collect orders and refund info
  for (const line of lines) {
    const obj = JSON.parse(line);

    // Process order
    if (obj.__typename === "Order" || obj.id?.includes("Order")) {
      const orderData = parseOrder(obj, shop);
      ordersBatch.push(orderData);

      // Track order ID for cleanup
      const orderId = obj.id.split("/").pop();
      orderIds.push(orderId);

      // Store order metadata for lineItems to reference
      orderMetadataMap.set(obj.id, obj);

      // Debug first order with refunds
      if (obj.refunds && obj.refunds.length > 0 && orderRefunds.size === 0) {
        console.log(`📝 First order with refunds: ${orderId}, refunds count: ${obj.refunds.length}`);
        console.log(`📝 Refund structure:`, JSON.stringify(obj.refunds[0]).substring(0, 200));
      }

      // Store refund info for later SKU processing
      if (obj.refunds && obj.refunds.length > 0) {
        orderRefunds.set(obj.id, obj.refunds);
      }

      // Note: We DON'T upsert during parsing - we collect ALL data first,
      // then cleanup, then insert. This ensures we only delete orders that
      // Shopify actually returned.
    }
  }

  console.log(`📦 Collected ${ordersBatch.length} orders from Shopify`);
  ordersProcessed = ordersBatch.length;

  // SECOND PASS: Collect refunds (Bulk API returns them as separate JSONL lines)
  console.log(`🔍 Collecting refunds from JSONL...`);
  for (const line of lines) {
    const obj = JSON.parse(line);

    // Refunds have __parentId (references Order) and no sku
    if (obj.__parentId && !obj.sku && obj.id?.includes("Refund")) {
      if (!orderRefunds.has(obj.__parentId)) {
        orderRefunds.set(obj.__parentId, []);
      }
      orderRefunds.get(obj.__parentId).push(obj);
    }
  }

  console.log(`📦 Found ${orderRefunds.size} orders with refunds in Bulk API response`);

  // THIRD PASS: Process lineItems (Bulk API returns them as separate JSONL lines)
  console.log(`🔍 Processing lineItems from JSONL...`);
  for (const line of lines) {
    const obj = JSON.parse(line);

    // LineItems have __parentId (references Order) and sku field
    if (!obj.__parentId || !obj.sku) continue;

    const order = orderMetadataMap.get(obj.__parentId);
    if (!order) continue;

    const skuData = parseLineItem(obj, order, shop, orderRefunds.get(obj.__parentId));
    if (skuData) {
      skusBatch.push(skuData);
    }
  }

  console.log(`📦 Collected ${ordersBatch.length} orders and ${skusBatch.length} SKUs from Shopify`);

  // Fetch full refund details via REST API for orders with refunds
  if (orderRefunds.size > 0) {
    console.log(`🔍 Fetching refund details for ${orderRefunds.size} orders via REST API...`);
    const token = Deno.env.get(`SHOPIFY_TOKEN_${shop.split('-')[1].toUpperCase()}`);

    let fetchedCount = 0;
    let fetchFailCount = 0;

    for (const [orderId, basicRefunds] of orderRefunds.entries()) {
      const numericOrderId = orderId.split("/").pop();
      try {
        const refundsUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${numericOrderId}/refunds.json`;
        const refundsResponse = await fetch(refundsUrl, {
          headers: { "X-Shopify-Access-Token": token! }
        });

        if (refundsResponse.ok) {
          const refundsData = await refundsResponse.json();
          orderRefunds.set(orderId, refundsData.refunds);
          fetchedCount++;

          // Debug first refund
          if (fetchedCount === 1) {
            console.log(`📝 Sample refund structure for order ${numericOrderId}:`, JSON.stringify(refundsData.refunds[0]).substring(0, 300));
          }
        } else {
          fetchFailCount++;
          console.error(`⚠️  Failed to fetch refunds for order ${numericOrderId}: ${refundsResponse.status}`);
        }
      } catch (err) {
        fetchFailCount++;
        console.error(`⚠️  Exception fetching refunds for order ${numericOrderId}:`, err);
      }
    }

    console.log(`✅ Fetched ${fetchedCount} refund details successfully, ${fetchFailCount} failed`);
  } else {
    console.log(`ℹ️  No orders with refunds detected in Bulk API response`);
  }

  if (orderRefunds.size > 0) {
    console.log(`🔄 Re-processing SKUs with full refund data...`);

    // Re-process SKUs with full refund data
    skusBatch.length = 0; // Clear existing SKUs
    for (const line of lines) {
      const obj = JSON.parse(line);

      // LineItems have __parentId, Orders don't
      if (!obj.__parentId || !obj.sku) continue;

      const order = orderMetadataMap.get(obj.__parentId);
      if (!order) continue;

      const skuData = parseLineItem(obj, order, shop, orderRefunds.get(obj.__parentId));
      if (skuData) {
        skusBatch.push(skuData);
      }
    }
  }

  ordersProcessed = ordersBatch.length;
  skusProcessed = skusBatch.length;

  // SAFE APPROACH: No cleanup - just upsert
  // Upsert will update existing records and insert new ones
  // This prevents data loss if Shopify query fails or returns partial data
  console.log(`📝 Upserting ${ordersBatch.length} orders and ${skusBatch.length} SKUs (no delete)...`);

  // Upsert all data in batches (to avoid memory issues with very large datasets)
  if (ordersBatch.length > 0) {
    console.log(`📝 Inserting ${ordersBatch.length} orders in batches...`);
    for (let i = 0; i < ordersBatch.length; i += BATCH_SIZE) {
      const batch = ordersBatch.slice(i, i + BATCH_SIZE);
      await upsertOrders(supabase, batch);
      console.log(`   ✅ Inserted ${Math.min(i + BATCH_SIZE, ordersBatch.length)}/${ordersBatch.length} orders`);
    }
  }

  if (skusBatch.length > 0) {
    console.log(`📝 Inserting ${skusBatch.length} SKUs in batches...`);
    for (let i = 0; i < skusBatch.length; i += BATCH_SIZE) {
      const batch = skusBatch.slice(i, i + BATCH_SIZE);
      await upsertSkus(supabase, batch);
      console.log(`   ✅ Inserted ${Math.min(i + BATCH_SIZE, skusBatch.length)}/${skusBatch.length} SKUs`);
    }
  }

  console.log(`✅ Processed ${ordersProcessed} orders and ${skusProcessed} SKUs`);

  return { ordersProcessed, skusProcessed };
}

function parseOrder(order: any, shop: string): any {
  const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode || "DKK";
  const rate = CURRENCY_RATES[currency] || 1.0;

  // Calculate values
  const currentTotal = parseFloat(order.currentTotalPriceSet?.shopMoney?.amount || "0") * rate;
  const totalTax = parseFloat(order.totalTaxSet?.shopMoney?.amount || "0") * rate;
  const totalDiscounts = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || "0") * rate;
  const shippingCostExTax = parseFloat(order.shippingLine?.discountedPriceSet?.shopMoney?.amount || "0") * rate;

  // Calculate refund data
  let refundedAmount = 0;
  let refundedQty = 0;
  let refundDate = null;

  if (order.refunds && order.refunds.length > 0) {
    for (const refund of order.refunds) {
      refundedAmount += parseFloat(refund.totalRefundedSet?.shopMoney?.amount || "0") * rate;

      for (const edge of refund.refundLineItems?.edges || []) {
        refundedQty += edge.node.quantity || 0;
      }

      const processedAt = refund.transactions?.edges?.[0]?.node?.processedAt || refund.createdAt;
      if (processedAt && (!refundDate || new Date(processedAt) > new Date(refundDate))) {
        refundDate = processedAt;
      }
    }
  }

  // Item count
  let itemCount = 0;
  for (const edge of order.lineItems?.edges || []) {
    itemCount += edge.node.quantity || 0;
  }

  return {
    shop,
    order_id: order.id.split("/").pop(),
    created_at: order.createdAt,
    country: order.shippingAddress?.countryCode || "DK",
    discounted_total: currentTotal,
    tax: totalTax,
    shipping: shippingCostExTax,
    item_count: itemCount,
    refunded_amount: refundedAmount,
    refunded_qty: refundedQty,
    refund_date: refundDate,
    total_discounts_ex_tax: totalDiscounts,
    cancelled_qty: 0, // Will be calculated from SKUs
    sale_discount_total: 0, // Not available in bulk data
    combined_discount_total: totalDiscounts,
  };
}

function parseLineItem(lineItem: any, order: any, shop: string, refunds: any[]): any {
  if (!lineItem.sku) return null;

  const currency = lineItem.originalUnitPriceSet?.shopMoney?.currencyCode || "DKK";
  const rate = CURRENCY_RATES[currency] || 1.0;

  // Prices (incl. tax)
  const originalUnitPrice = parseFloat(lineItem.originalUnitPriceSet?.shopMoney?.amount || "0") * rate;
  const discountedUnitPrice = parseFloat(lineItem.discountedUnitPriceSet?.shopMoney?.amount || "0") * rate;
  const totalDiscount = parseFloat(lineItem.totalDiscountSet?.shopMoney?.amount || "0") * rate;

  // Tax amount per unit
  // Try to get tax from taxLines if available
  const taxLinesArray = Array.isArray(lineItem.taxLines) ? lineItem.taxLines : (lineItem.taxLines?.edges?.map((e: any) => e.node) || []);
  let totalTaxPerUnit = 0;

  if (taxLinesArray.length > 0) {
    // Use actual tax amounts from taxLines
    totalTaxPerUnit = taxLinesArray.reduce((sum: number, taxLine: any) => {
      const taxAmount = parseFloat(taxLine.priceSet?.shopMoney?.amount || "0");
      return sum + taxAmount;
    }, 0) * rate;
  } else {
    // Fallback: calculate tax proportionally from order-level tax
    // This ensures we don't use hardcoded rates
    const orderTotalTax = parseFloat(order.totalTaxSet?.shopMoney?.amount || "0") * rate;
    const orderSubtotal = parseFloat(order.subtotalPriceSet?.shopMoney?.amount || "0") * rate;

    if (orderSubtotal > 0) {
      // Calculate this item's share of total tax based on its price
      const itemProportion = discountedUnitPrice / orderSubtotal;
      totalTaxPerUnit = orderTotalTax * itemProportion;
    }
  }

  // Calculate price_dkk (ex tax) by subtracting tax from discounted price
  const priceExTax = discountedUnitPrice - totalTaxPerUnit;

  // Find refund data for this SKU - match on multiple fields
  let refundedQty = 0;
  let refundedAmount = 0;
  let refundDate = null;
  let matchFound = false;

  if (refunds) {
    for (const refund of refunds) {
      // REST API format: refund.refund_line_items is array
      const refundLineItems = refund.refund_line_items || [];

      for (const refundLineItem of refundLineItems) {
        // Extract IDs for matching
        const refundedLineItemId = refundLineItem.line_item_id;
        const refundedVariantId = refundLineItem.line_item?.variant_id;
        const refundedSku = refundLineItem.line_item?.sku;

        const lineItemIdNumeric = lineItem.id.split("/").pop();
        const variantIdNumeric = lineItem.variant?.id?.split("/").pop() || lineItem.variantId;
        const currentSku = lineItem.sku;

        // Match on ANY of: line_item_id, variant_id, or sku
        const idMatch = refundedLineItemId == lineItemIdNumeric;
        const variantMatch = refundedVariantId && variantIdNumeric && refundedVariantId == variantIdNumeric;
        const skuMatch = refundedSku && currentSku && refundedSku === currentSku;

        if (idMatch || variantMatch || skuMatch) {
          matchFound = true;
          const qty = refundLineItem.quantity || 0;
          const subtotal = parseFloat(refundLineItem.subtotal || "0");

          refundedQty += qty;
          refundedAmount += subtotal * rate;

          // Use refund.created_at as refund date
          const refundCreatedAt = refund.created_at || refund.createdAt;

          if (refundCreatedAt && (!refundDate || new Date(refundCreatedAt) > new Date(refundDate))) {
            refundDate = refundCreatedAt;
          }
        }
      }
    }

    // Log warning if order has refunds but no match found for this SKU
    if (!matchFound && refunds.length > 0) {
      console.log(`⚠️  No refund match for SKU ${lineItem.sku} in order ${order.id.split("/").pop()}`);
    }
  }

  return {
    shop,
    order_id: order.id.split("/").pop(),
    sku: lineItem.sku,
    created_at: order.createdAt,
    country: order.shippingAddress?.countryCode || "DK",
    product_title: lineItem.name,
    variant_title: lineItem.variantTitle,
    quantity: lineItem.quantity,
    refunded_qty: refundedQty,
    refunded_amount_dkk: refundedAmount,
    price_dkk: priceExTax,
    refund_date: refundDate,
    total_discount_dkk: totalDiscount * rate,
    discount_per_unit_dkk: (totalDiscount * rate) / lineItem.quantity,
    cancelled_qty: 0, // Will be updated separately if needed
  };
}

async function upsertOrders(supabase: any, orders: any[]): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .upsert(orders, { onConflict: "shop,order_id" });

  if (error) {
    throw new Error(`Failed to upsert orders: ${error.message}`);
  }
}

async function upsertSkus(supabase: any, skus: any[]): Promise<void> {
  const { error } = await supabase
    .from("skus")
    .upsert(skus, { onConflict: "shop,order_id,sku" });

  if (error) {
    throw new Error(`Failed to upsert SKUs: ${error.message}`);
  }
}
