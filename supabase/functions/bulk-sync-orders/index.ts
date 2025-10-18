// Shopify Bulk Sync Orders - Optimized version
// Purpose: Sync order-level data from Shopify to Supabase orders table
// Note: This function ONLY handles orders, not SKUs (separated concerns)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SHOPIFY_CONFIG } from "../_shared/config.ts";
import { getShopifyToken as getToken, getCurrencyMultiplier, getTaxRate, withRetry } from "../_shared/shopify.ts";
import { createAuthenticatedClient, batchUpsert } from "../_shared/supabase.ts";
import type { ShopifyOrder, OrderRecord, BulkSyncJob, BulkOperationResult, ShopifyBulkOperation } from "../_shared/types.ts";

// Bulk Operations Configuration
const POLL_INTERVAL_MS = 5000; // 10 seconds
const MAX_POLL_ATTEMPTS = 360; // 1 hour max
const EDGE_FUNCTION_TIMEOUT_MS = 300000; // 5 minutes safety margin

// Default tax rates by country (fallback when taxLines is empty)
// These are standard VAT rates for EU countries where Pompdelux operates
function getDefaultTaxRateByCountry(countryCode: string | null): number {
  if (!countryCode) return 0.25; // Default to Danish VAT if no country

  const taxRates: { [key: string]: number } = {
    'DK': 0.25, // Denmark - 25%
    'DE': 0.19, // Germany - 19%
    'NL': 0.21, // Netherlands - 21%
    'CH': 0.077, // Switzerland - 7.7%
    // Other EU countries where Pompdelux might ship
    'SE': 0.25, // Sweden - 25%
    'NO': 0.25, // Norway - 25%
    'AT': 0.20, // Austria - 20%
    'BE': 0.21, // Belgium - 21%
    'FI': 0.24, // Finland - 24%
    'FR': 0.20, // France - 20%
    'IT': 0.22, // Italy - 22%
    'ES': 0.21, // Spain - 21%
    'PL': 0.23, // Poland - 23%
  };

  return taxRates[countryCode] || 0.25; // Default to 25% if country not in list
}

interface BulkSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  testMode?: boolean; // For testing without affecting production
}

serve(async (req) => {
  const functionStartTime = Date.now();

  try {
    // Parse and validate request
    const body = await req.json();
    const { shop, startDate, endDate, testMode = false, jobId } = body;

    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop, startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Starting order sync for ${shop} (${startDate} to ${endDate})${testMode ? ' [TEST MODE]' : ''}${jobId ? ` [Job ID: ${jobId}]` : ''}`);

    // Initialize clients
    const supabase = createAuthenticatedClient();
    const shopifyToken = getToken(shop);

    // Use existing job if provided, otherwise create new one
    let finalJobId = jobId;
    if (!jobId) {
      const jobResult = await createOrUpdateJob(supabase, {
        shop,
        object_type: "orders",
        start_date: startDate,
        end_date: endDate,
        status: "running",
      }, testMode);

      if (!jobResult.success || !jobResult.jobId) {
        throw new Error(jobResult.error || "Failed to create job");
      }
      finalJobId = jobResult.jobId;
    } else {
      // Job already exists from orchestrator - just update status to running
      await supabase
        .from("bulk_sync_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId);
    }

    // Process date range day by day
    const results = await processDailyBatches({
      shop,
      shopifyToken,
      startDate,
      endDate,
      supabase,
      testMode,
      jobId: finalJobId,
      functionStartTime,
    });

    // Update job with final status
    await updateJobStatus(supabase, finalJobId, {
      status: results.hasErrors ? "failed" : "completed",
      records_processed: results.totalRecords,
      error_message: results.errors.join("; "),
    }, testMode);

    return new Response(
      JSON.stringify({
        success: !results.hasErrors,
        message: `Processed ${results.totalRecords} orders across ${results.daysProcessed} days`,
        details: results,
        testMode,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Fatal error in bulk-sync-orders:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        testMode: false
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function createOrUpdateJob(
  supabase: any,
  jobData: Partial<BulkSyncJob>,
  testMode: boolean
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  if (testMode) {
    // In test mode, don't create actual job records
    return { success: true, jobId: `test-${Date.now()}` };
  }

  const { data, error } = await supabase
    .from("bulk_sync_jobs")
    .insert({
      ...jobData,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, jobId: data.id };
}

async function updateJobStatus(
  supabase: any,
  jobId: string,
  updates: Partial<BulkSyncJob>,
  testMode: boolean
): Promise<void> {
  if (testMode) {
    console.log(`[TEST MODE] Would update job ${jobId}:`, updates);
    return;
  }

  await supabase
    .from("bulk_sync_jobs")
    .update({
      ...updates,
      completed_at: updates.status === "completed" || updates.status === "failed"
        ? new Date().toISOString()
        : undefined,
    })
    .eq("id", jobId);
}

interface ProcessingConfig {
  shop: string;
  shopifyToken: string;
  startDate: string;
  endDate: string;
  supabase: any;
  testMode: boolean;
  jobId: string;
  functionStartTime: number;
}

interface ProcessingResults {
  totalRecords: number;
  daysProcessed: number;
  errors: string[];
  hasErrors: boolean;
}

async function processDailyBatches(config: ProcessingConfig): Promise<ProcessingResults> {
  const results: ProcessingResults = {
    totalRecords: 0,
    daysProcessed: 0,
    errors: [],
    hasErrors: false,
  };

  const days = getDaysBetween(config.startDate, config.endDate);
  console.log(`📅 Processing ${days.length} days...`);

  for (const day of days) {
    // Check timeout
    if (Date.now() - config.functionStartTime > EDGE_FUNCTION_TIMEOUT_MS) {
      console.log("⏱️ Approaching timeout, stopping gracefully");
      break;
    }

    try {
      const dayResult = await processSingleDay({
        ...config,
        startDate: day,
        endDate: day,
      });

      results.totalRecords += dayResult.recordsProcessed || 0;
      results.daysProcessed++;

      console.log(`✅ Day ${day}: ${dayResult.recordsProcessed} orders`);
    } catch (error) {
      const errorMsg = `Failed ${day}: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(errorMsg);
      results.errors.push(errorMsg);
      results.hasErrors = true;
    }
  }

  return results;
}

async function processSingleDay(config: ProcessingConfig): Promise<BulkOperationResult> {
  const { shop, shopifyToken, startDate, endDate, supabase, testMode } = config;

  console.log(`📅 Processing ${startDate} for ${shop}...`);

  // Start bulk operation
  const bulkOp = await startBulkOperation(shop, shopifyToken, startDate, endDate);
  if (!bulkOp.success || !bulkOp.operation) {
    const errorMsg = bulkOp.error || "Failed to start bulk operation";
    console.error(`❌ Failed to start bulk operation: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`🚀 Bulk operation started: ${bulkOp.operation.id}`);

  // Poll for completion
  const resultUrl = await pollBulkOperation(shop, shopifyToken, bulkOp.operation.id);
  if (!resultUrl) {
    // Check the specific operation status
    const finalStatus = await checkBulkOperationStatus(shop, shopifyToken, bulkOp.operation.id);
    if (finalStatus?.errorCode === "ACCESS_DENIED") {
      throw new Error("ACCESS_DENIED: The Shopify token may lack required permissions for bulk operations");
    } else if (finalStatus?.status === "FAILED") {
      throw new Error(`Bulk operation failed with error: ${finalStatus.errorCode || "Unknown error"}`);
    } else {
      throw new Error("Bulk operation timed out or was cancelled");
    }
  }

  // Download and process results
  console.log(`📥 Downloading results from: ${resultUrl}`);
  const orders = await downloadBulkResults(resultUrl);

  if (orders.length === 0) {
    console.log(`ℹ️ No orders found for ${startDate}`);
    return { success: true, message: "No orders found", recordsProcessed: 0 };
  }

  console.log(`📦 Found ${orders.length} orders to process`);

  // Transform orders for database
  const orderRecords = orders.map(order => transformOrder(order, shop));

  // Insert to database
  if (testMode) {
    console.log(`[TEST MODE] Would insert ${orderRecords.length} orders`);
    return { success: true, message: "Test mode - no data written", recordsProcessed: orderRecords.length };
  }

  const { success, error } = await batchUpsert(
    supabase,
    "orders",
    orderRecords,
    ["shop", "order_id"]
  );

  if (!success) {
    throw new Error(error?.message || "Failed to insert orders");
  }

  console.log(`✅ Successfully synced ${orderRecords.length} orders for ${startDate}`);
  return { success: true, message: "Orders synced", recordsProcessed: orderRecords.length };
}

async function startBulkOperation(
  shop: string,
  shopifyToken: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; operation?: ShopifyBulkOperation; error?: string }> {
  // First, check if there's an existing bulk operation
  const existingOp = await checkBulkOperationStatus(shop, shopifyToken);

  if (existingOp) {
    console.log(`ℹ️ Found existing bulk operation: Status=${existingOp.status}, Error=${existingOp.errorCode || 'None'}`);

    // Handle different statuses
    if (existingOp.status === "RUNNING" || existingOp.status === "CREATED") {
      console.log("⚠️ Cancelling active bulk operation...");
      const cancelResult = await cancelBulkOperation(shop, shopifyToken);
      if (cancelResult.success) {
        console.log("✅ Cancelled existing bulk operation");
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error("❌ Failed to cancel:", cancelResult.error);
      }
    } else if (existingOp.status === "FAILED") {
      console.warn(`⚠️ Previous operation failed with ${existingOp.errorCode} - ignoring and proceeding...`);
      // Failed operations should not block new ones
      // Shopify should allow a new operation even if the last one failed
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else if (existingOp.status === "COMPLETED") {
      console.log("ℹ️ Previous operation completed - safe to start new one");
    }
  }

  // For same-day queries, add a small delay to allow Shopify indexing
  const queryDate = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (queryDate.getTime() === today.getTime()) {
    console.log("⏳ Same-day query detected, adding 3-second delay for Shopify indexing...");
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(
            query: "created_at:>='${startDate}T00:00:00Z' AND created_at:<='${endDate}T23:59:59Z'"
            sortKey: CREATED_AT
          ) {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                cancelledAt
                subtotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalDiscountsSet {
                  shopMoney {
                    amount
                  }
                }
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                  }
                }
                shippingLines(first: 5) {
                  edges {
                    node {
                      title
                      originalPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                      discountedPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                      discountAllocations {
                        allocatedAmountSet {
                          shopMoney {
                            amount
                          }
                        }
                      }
                      taxLines {
                        rate
                      }
                    }
                  }
                }
                taxLines {
                  title
                  rate
                  ratePercentage
                  priceSet {
                    shopMoney {
                      amount
                    }
                  }
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
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

  return withRetry(async () => {
    const response = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_CONFIG.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();
    if (data.errors) {
      // Check if error is about existing operation
      const errorStr = JSON.stringify(data.errors);
      if (errorStr.includes("already running") || errorStr.includes("bulk operation")) {
        return {
          success: false,
          error: "Bulk operation conflict - another operation may be running. Please try again in a moment."
        };
      }
      throw new Error(errorStr);
    }

    const result = data.data?.bulkOperationRunQuery;
    if (result?.userErrors?.length > 0) {
      const userErrorStr = JSON.stringify(result.userErrors);
      // Check for bulk operation already running error
      if (userErrorStr.includes("already running") || userErrorStr.includes("bulk operation")) {
        return {
          success: false,
          error: "A bulk operation is already running. Please wait and try again."
        };
      }
      throw new Error(userErrorStr);
    }

    if (!result?.bulkOperation) {
      return {
        success: false,
        error: "No bulk operation returned from Shopify"
      };
    }

    console.log(`✅ Bulk operation started with ID: ${result.bulkOperation.id}`);
    return {
      success: true,
      operation: result.bulkOperation as ShopifyBulkOperation
    };
  });
}

async function cancelBulkOperation(
  shop: string,
  shopifyToken: string
): Promise<{ success: boolean; error?: string }> {
  const query = `
    mutation {
      bulkOperationCancel {
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

  try {
    const response = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_CONFIG.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    if (data.errors) {
      return { success: false, error: JSON.stringify(data.errors) };
    }

    const result = data.data?.bulkOperationCancel;
    if (result?.userErrors?.length > 0) {
      return { success: false, error: JSON.stringify(result.userErrors) };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error cancelling operation"
    };
  }
}

async function pollBulkOperation(
  shop: string,
  shopifyToken: string,
  operationId: string
): Promise<string | null> {
  console.log(`📊 Polling bulk operation ${operationId}...`);
  let lastStatus = "";

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    // Try to get the specific operation by ID first
    let status = await checkBulkOperationStatus(shop, shopifyToken, operationId);

    // If that fails, fall back to currentBulkOperation
    if (!status) {
      status = await checkBulkOperationStatus(shop, shopifyToken);
      if (status && status.id !== operationId) {
        console.log(`⚠️ Current operation is different (${status.id}), waiting for our operation...`);
        continue;
      }
    }

    if (!status) {
      console.log(`⚠️ Poll attempt ${attempt + 1}: No status returned`);
      continue;
    }

    // Only log if status changed
    if (status.status !== lastStatus) {
      console.log(`📊 Poll attempt ${attempt + 1}: Status = ${status.status}, Objects = ${status.objectCount || 0}`);
      lastStatus = status.status;
    }

    if (status.status === "COMPLETED" && status.url) {
      console.log(`✅ Bulk operation completed! Objects processed: ${status.objectCount || 0}`);
      return status.url;
    }

    if (status.status === "FAILED") {
      console.error(`❌ Bulk operation FAILED with error: ${status.errorCode || "Unknown error"}`);
      return null;
    }

    if (status.status === "CANCELLED") {
      console.error(`🚫 Bulk operation was CANCELLED`);
      return null;
    }
  }

  console.error(`⏱️ Bulk operation timed out after ${MAX_POLL_ATTEMPTS} attempts`);
  return null;
}

async function checkBulkOperationStatus(
  shop: string,
  shopifyToken: string,
  operationId?: string
): Promise<ShopifyBulkOperation | null> {
  // If we have a specific operation ID, try to get it directly
  const query = operationId ? `
    query {
      node(id: "${operationId}") {
        ... on BulkOperation {
          id
          status
          errorCode
          url
          objectCount
          fileSize
        }
      }
    }
  ` : `
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

  try {
    const response = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_CONFIG.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    if (operationId) {
      // When querying by ID, the result is in node
      return data.data?.node;
    } else {
      // When querying currentBulkOperation
      return data.data?.currentBulkOperation;
    }
  } catch (error) {
    console.error("Error checking bulk operation status:", error);
    return null;
  }
}

async function downloadBulkResults(url: string): Promise<ShopifyOrder[]> {
  const response = await fetch(url);
  const text = await response.text();

  const orders: Map<string, ShopifyOrder> = new Map();
  const shippingLines: Map<string, any[]> = new Map();
  const lines = text.trim().split('\n');

  // First pass: collect all orders and shipping lines
  for (const line of lines) {
    if (!line) continue;
    try {
      const data = JSON.parse(line);

      // Check by __typename field (more reliable than checking ID string)
      if (data.__typename === "Order" || (data.id && data.id.includes("Order"))) {
        // Initialize shippingLines as empty array
        data.shippingLines = { edges: [] };
        orders.set(data.id, data);
      } else if (data.__typename === "ShippingLine" || (data.id && data.id.includes("ShippingLine"))) {
        // Store shipping line for later attachment to parent order
        const parentId = data.__parentId;
        if (parentId) {
          if (!shippingLines.has(parentId)) {
            shippingLines.set(parentId, []);
          }
          shippingLines.get(parentId)!.push(data);
          console.log(`📦 Found ShippingLine for order ${parentId}: originalPrice=${data.originalPriceSet?.shopMoney?.amount}, discountedPrice=${data.discountedPriceSet?.shopMoney?.amount}`);
        }
      }
    } catch (e) {
      console.error("Error parsing line:", e);
    }
  }

  // Second pass: attach shipping lines to orders
  for (const [orderId, order] of orders.entries()) {
    const lines = shippingLines.get(orderId) || [];
    order.shippingLines = {
      edges: lines.map(line => ({ node: line }))
    };
    if (lines.length > 0) {
      console.log(`📦 Attached ${lines.length} shipping line(s) to order ${orderId}`);
    }
  }

  console.log(`✅ Downloaded ${orders.size} orders with shipping data`);
  return Array.from(orders.values());
}

function transformOrder(order: ShopifyOrder, shop: string): OrderRecord {
  const currencyMultiplier = getCurrencyMultiplier(shop);
  const taxRate = getTaxRate(shop);

  const subtotal = parseFloat(order.subtotalPriceSet.shopMoney.amount) * currencyMultiplier;
  const total = parseFloat(order.totalPriceSet.shopMoney.amount) * currencyMultiplier;
  const totalDiscount = parseFloat(order.totalDiscountsSet.shopMoney.amount) * currencyMultiplier;
  const totalTax = parseFloat(order.totalTaxSet.shopMoney.amount) * currencyMultiplier;
  const shipping = parseFloat(order.totalShippingPriceSet.shopMoney.amount) * currencyMultiplier;

  // Extract order ID
  const orderId = order.id.split('/').pop() || order.id;

  // Extract tax rate from taxLines (use first tax line, typically only one)
  let actualTaxRate: number | null = null;
  if (order.taxLines && order.taxLines.length > 0) {
    // Use rate field (decimal format like 0.25 for 25%)
    actualTaxRate = order.taxLines[0].rate;
    console.log(`📊 Order ${orderId}: tax rate ${actualTaxRate} (${actualTaxRate * 100}%)`);
  } else {
    // Fallback: Use country-based tax rate if taxLines is empty
    // This happens for ~1% of orders where Shopify Bulk API doesn't return taxLines
    const countryCode = order.shippingAddress?.countryCode || null;
    actualTaxRate = getDefaultTaxRateByCountry(countryCode);
    console.log(`⚠️ Order ${orderId}: No taxLines found, using fallback tax rate ${actualTaxRate} for country ${countryCode}`);
  }

  // Calculate shipping fields
  // NOTE: Shopify Bulk Operations API does NOT export shippingLines nested data
  // Solution: Calculate shipping EX VAT from totalShippingPriceSet (INCL VAT) using tax_rate
  let shippingPriceDkk = 0;
  let shippingDiscountDkk = 0;

  if (shipping > 0) {
    // shipping is INCL VAT, so divide by (1 + taxRate) to get EX VAT
    const shippingTaxRate = actualTaxRate || taxRate;
    shippingPriceDkk = shipping / (1 + shippingTaxRate);

    // NOTE: Shipping discount cannot be calculated from Bulk API
    // It requires fetching shippingLines data via separate GraphQL query per order
    // For now, keep shipping_discount_dkk as 0
  }

  // Calculate values for the actual database schema
  const discountedTotal = total - shipping; // Total minus shipping
  const totalDiscountsExTax = totalDiscount; // Discount amount

  return {
    shop,
    order_id: orderId,
    created_at: order.createdAt,
    updated_at: order.updatedAt || order.createdAt,
    country: shop.includes('-da') ? 'DK' :
            shop.includes('-de') ? 'DE' :
            shop.includes('-nl') ? 'NL' :
            shop.includes('-chf') ? 'CH' : 'INT',
    discounted_total: discountedTotal,
    tax: totalTax > 0 ? totalTax : calculateTax(subtotal, totalDiscount, taxRate),
    tax_rate: actualTaxRate, // Actual tax rate from Shopify taxLines
    shipping: shipping,
    shipping_price_dkk: shippingPriceDkk, // Shipping price EX VAT
    shipping_discount_dkk: shippingDiscountDkk, // Shipping discount EX VAT
    item_count: order.lineItems?.edges?.length || 0,
    refunded_amount: 0, // Will be updated by bulk-sync-refunds
    refunded_qty: 0, // Will be updated by bulk-sync-refunds
    refund_date: null, // Will be updated by bulk-sync-refunds
    total_discounts_ex_tax: totalDiscountsExTax,
    cancelled_qty: 0, // Will be updated by bulk-sync-refunds if order is cancelled
    raw_data: {
      tax: totalTax > 0 ? totalTax : calculateTax(subtotal, totalDiscount, taxRate),
      shop,
      country: shop.includes('-da') ? 'DK' :
              shop.includes('-de') ? 'DE' :
              shop.includes('-nl') ? 'NL' :
              shop.includes('-chf') ? 'CH' : 'INT',
      orderId,
      shipping,
      createdAt: order.createdAt,
      itemCount: order.lineItems?.edges?.length || 0,
      refundDate: "",
      refundedQty: 0,
      cancelledQty: 0,
      refundedAmount: 0,
      discountedTotal,
      saleDiscountTotal: 0, // Will be calculated from SKU data
      totalDiscountsExTax: totalDiscountsExTax,
      combinedDiscountTotal: totalDiscountsExTax
    },
    sale_discount_total: 0, // Will be calculated from SKU data
    combined_discount_total: totalDiscountsExTax
  };
}

function calculateTax(subtotal: number, discount: number, taxRate: number): number {
  return (subtotal - discount) * taxRate;
}

function getDaysBetween(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

