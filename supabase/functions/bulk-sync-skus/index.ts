// Shopify Bulk Operations Edge Sync for SKUs
// Handles line-item (SKU) level syncs without timeout limitations
// Uses Shopify Admin API Bulk Operations + Supabase Edge Functions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPIFY_API_VERSION = "2024-10";
const POLL_INTERVAL_MS = 10000; // 10 seconds
const BATCH_SIZE = 500;
const MAX_POLL_ATTEMPTS = 360; // 1 hour max (360 * 10s)
const MAX_RETRIES = 3; // Max retries per day on errors

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
  objectType?: "skus";
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
  skusProcessed: number;
  durationMs: number;
  error?: string;
}

serve(async (req) => {
  try {
    // Parse request
    const { shop, startDate, endDate, objectType = "skus" }: BulkSyncRequest = await req.json();

    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop, startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    console.log(`📋 Created SKU sync job ${job.id} for ${shop} (${startDate} to ${endDate})`);

    // Start multi-day processing
    await supabase
      .from("bulk_sync_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    const startTime = Date.now();
    const days = generateDailyIntervals(startDate, endDate);
    const dayResults: DayResult[] = [];

    console.log(`📅 Processing ${days.length} day(s) from ${startDate} to ${endDate}`);

    let totalSkus = 0;

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const dayStart = Date.now();

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
        totalSkus += dayResult.skusProcessed;
        const dayDuration = (dayResult.durationMs / 1000).toFixed(1);
        console.log(`✅ Day completed: ${day.date} (${dayResult.skusProcessed} SKUs, ${dayDuration}s)`);
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
        skus_synced: totalSkus,
        records_processed: totalSkus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    const successfulDays = dayResults.filter((r) => r.status === "success").length;
    const failedDays = dayResults.filter((r) => r.status === "failed").length;
    const skippedDays = dayResults.filter((r) => r.status === "skipped").length;

    console.log(`\n🟡 Summary: ${totalSkus} SKUs synced in ${successfulDays} days, ${(totalDuration / 1000).toFixed(0)}s total`);
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
        skusProcessed: totalSkus,
        recordsProcessed: totalSkus,
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
      const supabase = createClient(supabaseUrl, supabaseKey);

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

      const skusProcessed = await processJSONL(
        completedOp.url!,
        shop,
        supabase,
        jobId
      );

      return {
        day,
        status: "success",
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
  // GraphQL Bulk Operation for LineItems
  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(query: "created_at:>=${startDate} created_at:<=${endDate}") {
            edges {
              node {
                id
                name
                createdAt
                shippingAddress {
                  countryCode
                }
                lineItems {
                  edges {
                    node {
                      id
                      sku
                      quantity
                      name
                      variantTitle
                      discountedUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                      totalDiscountSet {
                        shopMoney { amount currencyCode }
                      }
                      taxLines {
                        rate
                      }
                    }
                  }
                }
                refunds {
                  createdAt
                  refundLineItems {
                    edges {
                      node {
                        quantity
                        priceSet {
                          shopMoney { amount currencyCode }
                        }
                        lineItem {
                          id
                        }
                      }
                    }
                  }
                  transactions {
                    edges {
                      node {
                        processedAt
                      }
                    }
                  }
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
): Promise<number> {
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.split("\n").filter((line) => line.trim());

  console.log(`📄 Processing ${lines.length} JSONL lines...`);

  const skusBatch: any[] = [];
  const orderRefunds: Map<string, any[]> = new Map();
  const orderData: Map<string, any> = new Map();

  let skusProcessed = 0;

  // First pass: collect orders and refunds
  for (const line of lines) {
    const obj = JSON.parse(line);

    if (obj.__typename === "Order" || obj.id?.includes("Order")) {
      orderData.set(obj.id, {
        id: obj.id,
        name: obj.name,
        createdAt: obj.createdAt,
        countryCode: obj.shippingAddress?.countryCode || "DK",
      });

      if (obj.refunds && obj.refunds.length > 0) {
        orderRefunds.set(obj.id, obj.refunds);
      }
    }
  }

  // Second pass: process line items
  for (const line of lines) {
    const obj = JSON.parse(line);

    if (obj.__typename === "LineItem" || obj.id?.includes("LineItem")) {
      const orderId = obj.__parentId; // Shopify Bulk Operations uses __parentId to link

      if (!orderId || !orderData.has(orderId)) continue;

      const order = orderData.get(orderId);
      const refunds = orderRefunds.get(orderId) || [];

      const skuData = parseLineItem(obj, order, shop, refunds);
      if (skuData) {
        skusBatch.push(skuData);

        // Batch upsert when reaching batch size
        if (skusBatch.length >= BATCH_SIZE) {
          await upsertSkus(supabase, skusBatch);
          skusProcessed += skusBatch.length;
          skusBatch.length = 0;

          console.log(`✅ Upserted ${skusProcessed} SKUs...`);
        }
      }
    }
  }

  // Final batch upsert
  if (skusBatch.length > 0) {
    await upsertSkus(supabase, skusBatch);
    skusProcessed += skusBatch.length;
  }

  console.log(`✅ Processed ${skusProcessed} SKUs`);

  return skusProcessed;
}

function parseLineItem(lineItem: any, order: any, shop: string, refunds: any[]): any {
  if (!lineItem.sku) return null;

  const currency = lineItem.discountedUnitPriceSet?.shopMoney?.currencyCode || "DKK";
  const rate = CURRENCY_RATES[currency] || 1.0;

  // Tax rate
  const taxRate = lineItem.taxLines?.[0]?.rate || 0.25;

  // Prices
  const discountedUnitPrice = parseFloat(lineItem.discountedUnitPriceSet?.shopMoney?.amount || "0") * rate;
  const totalDiscount = parseFloat(lineItem.totalDiscountSet?.shopMoney?.amount || "0") * rate;

  // Calculate price_dkk (ex tax)
  const priceExTax = discountedUnitPrice / (1 + taxRate);

  // Find refund data for this SKU
  let refundedQty = 0;
  let cancelledAmountDkk = 0;
  let refundDate = null;

  if (refunds) {
    for (const refund of refunds) {
      const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount || "0");

      for (const edge of refund.refundLineItems?.edges || []) {
        if (edge.node.lineItem?.id === lineItem.id) {
          const refQty = edge.node.quantity || 0;
          refundedQty += refQty;

          // Check if this is a cancellation (refund total = 0)
          if (refundTotal === 0) {
            const cancelledPrice = parseFloat(edge.node.priceSet?.shopMoney?.amount || "0") * rate;
            const cancelledPriceExTax = cancelledPrice / (1 + taxRate);
            cancelledAmountDkk += cancelledPriceExTax * refQty;
          }

          const processedAt = refund.transactions?.edges?.[0]?.node?.processedAt || refund.createdAt;
          if (processedAt && (!refundDate || new Date(processedAt) > new Date(refundDate))) {
            refundDate = processedAt;
          }
        }
      }
    }
  }

  return {
    shop,
    order_id: order.id.split("/").pop(),
    sku: lineItem.sku,
    created_at: order.createdAt,
    country: order.countryCode,
    product_title: lineItem.name,
    variant_title: lineItem.variantTitle,
    quantity: lineItem.quantity,
    refunded_qty: refundedQty,
    cancelled_qty: refundedQty > 0 && cancelledAmountDkk > 0 ? refundedQty : 0,
    cancelled_amount_dkk: cancelledAmountDkk,
    price_dkk: priceExTax,
    refund_date: refundDate,
    total_discount_dkk: totalDiscount,
    discount_per_unit_dkk: totalDiscount / lineItem.quantity,
  };
}

async function upsertSkus(supabase: any, skus: any[]): Promise<void> {
  const { error } = await supabase
    .from("skus")
    .upsert(skus, { onConflict: "shop,order_id,sku" });

  if (error) {
    throw new Error(`Failed to upsert SKUs: ${error.message}`);
  }
}
