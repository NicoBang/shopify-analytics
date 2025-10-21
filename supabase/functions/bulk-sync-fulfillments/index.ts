// Shopify Bulk Sync Fulfillments
// Purpose: Sync fulfillment data from Shopify to Supabase fulfillments table
// Uses Bulk Operations API for efficient large-scale syncing

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SHOPIFY_CONFIG } from "../_shared/config.ts";
import { getShopifyToken as getToken, withRetry } from "../_shared/shopify.ts";
import { createAuthenticatedClient, batchUpsert } from "../_shared/supabase.ts";
import type { BulkSyncJob, BulkOperationResult, ShopifyBulkOperation } from "../_shared/types.ts";

// Bulk Operations Configuration
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360; // 30 minutes max
const EDGE_FUNCTION_TIMEOUT_MS = 300000; // 5 minutes safety margin

interface BulkSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  testMode?: boolean;
}

serve(async (req) => {
  const functionStartTime = Date.now();

  try {
    const body = await req.json();
    const { shop, startDate, endDate, testMode = false, jobId } = body;

    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop, startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`🚚 Starting fulfillment sync for ${shop} (${startDate} to ${endDate})${testMode ? ' [TEST MODE]' : ''}${jobId ? ` [Job ID: ${jobId}]` : ''}`);

    // Initialize clients
    const supabase = createAuthenticatedClient();
    const shopifyToken = getToken(shop);

    // Use existing job if provided, otherwise create new one
    let finalJobId = jobId;
    if (!jobId) {
      const jobResult = await createOrUpdateJob(supabase, {
        shop,
        object_type: "fulfillments",
        start_date: startDate,
        end_date: endDate,
        status: "running",
      }, testMode);

      if (!jobResult.success || !jobResult.jobId) {
        throw new Error(jobResult.error || "Failed to create job");
      }
      finalJobId = jobResult.jobId;
    } else {
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
        message: `Processed ${results.totalRecords} fulfillments across ${results.daysProcessed} days`,
        records_processed: results.totalRecords,
        details: results,
        testMode,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Fatal error in bulk-sync-fulfillments:", error);
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

      console.log(`✅ Day ${day}: ${dayResult.recordsProcessed} fulfillments`);
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
    throw new Error("Bulk operation timed out or failed");
  }

  // Download and process results
  console.log(`📥 Downloading results from: ${resultUrl}`);
  const fulfillments = await downloadBulkResults(resultUrl);

  if (fulfillments.length === 0) {
    console.log(`ℹ️ No fulfillments found for ${startDate}`);
    return { success: true, message: "No fulfillments found", recordsProcessed: 0 };
  }

  console.log(`📦 Found ${fulfillments.length} fulfillments to process`);

  // Insert to database
  if (testMode) {
    console.log(`[TEST MODE] Would insert ${fulfillments.length} fulfillments`);
    return { success: true, message: "Test mode - no data written", recordsProcessed: fulfillments.length };
  }

  const { success, error } = await batchUpsert(
    supabase,
    "fulfillments",
    fulfillments,
    ["order_id", "date", "country", "carrier"]
  );

  if (!success) {
    throw new Error(error?.message || "Failed to insert fulfillments");
  }

  console.log(`✅ Successfully synced ${fulfillments.length} fulfillments for ${startDate}`);
  return { success: true, message: "Fulfillments synced", recordsProcessed: fulfillments.length };
}

async function startBulkOperation(
  shop: string,
  shopifyToken: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; operation?: ShopifyBulkOperation; error?: string }> {
  // Cancel any existing operations first
  const existingOp = await checkBulkOperationStatus(shop, shopifyToken);
  if (existingOp && (existingOp.status === "RUNNING" || existingOp.status === "CREATED")) {
    console.log("⚠️ Cancelling active bulk operation...");
    await cancelBulkOperation(shop, shopifyToken);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // ✅ Query orders and use __parentId pattern for fulfillments
  // Bulk Operations API will export fulfillments with __parentId linking to order
  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(
            query: "created_at:>='${startDate}T00:00:00Z' AND created_at:<='${endDate}T23:59:59Z' AND fulfillment_status:shipped"
            sortKey: CREATED_AT
          ) {
            edges {
              node {
                id
                createdAt
                shippingAddress {
                  countryCode
                }
                fulfillments {
                  id
                  createdAt
                  trackingInfo {
                    company
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
      throw new Error(JSON.stringify(data.errors));
    }

    const result = data.data?.bulkOperationRunQuery;
    if (result?.userErrors?.length > 0) {
      throw new Error(JSON.stringify(result.userErrors));
    }

    if (!result?.bulkOperation) {
      return {
        success: false,
        error: "No bulk operation returned from Shopify"
      };
    }

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
    if (data.errors || data.data?.bulkOperationCancel?.userErrors?.length > 0) {
      return { success: false };
    }

    return { success: true };
  } catch (error) {
    return { success: false };
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

    const status = await checkBulkOperationStatus(shop, shopifyToken, operationId);

    if (!status) {
      console.log(`⚠️ Poll attempt ${attempt + 1}: No status returned`);
      continue;
    }

    if (status.status !== lastStatus) {
      console.log(`📊 Poll attempt ${attempt + 1}: Status = ${status.status}, Objects = ${status.objectCount || 0}`);
      lastStatus = status.status;
    }

    if (status.status === "COMPLETED" && status.url) {
      console.log(`✅ Bulk operation completed! Objects processed: ${status.objectCount || 0}`);
      return status.url;
    }

    if (status.status === "FAILED" || status.status === "CANCELLED") {
      console.error(`❌ Bulk operation ${status.status}`);
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
    return operationId ? data.data?.node : data.data?.currentBulkOperation;
  } catch (error) {
    console.error("Error checking bulk operation status:", error);
    return null;
  }
}

async function downloadBulkResults(url: string): Promise<any[]> {
  const response = await fetch(url);
  const text = await response.text();

  const orders: Map<string, any> = new Map();
  const fulfillments: any[] = [];
  const lines = text.trim().split('\n');

  // Parse JSONL format - orders and fulfillments (with __parentId)
  for (const line of lines) {
    if (!line) continue;
    try {
      const data = JSON.parse(line);

      if (data.__typename === "Order" || (data.id && data.id.includes("Order"))) {
        orders.set(data.id, data);
      } else if (data.__typename === "Fulfillment" || (data.id && data.id.includes("Fulfillment"))) {
        fulfillments.push(data);
      }
    } catch (e) {
      console.error("Error parsing line:", e);
    }
  }

  console.log(`📦 Found ${orders.size} orders, ${fulfillments.length} fulfillments in JSONL`);
  console.log(`📄 Total lines in JSONL: ${lines.length}`);

  if (lines.length > 0 && lines.length < 20) {
    console.log(`🔍 First few lines of JSONL:`);
    lines.slice(0, 5).forEach((line, i) => {
      if (line) console.log(`Line ${i}: ${line.substring(0, 200)}`);
    });
  }

  // Transform to fulfillment records
  const fulfillmentRecords: any[] = [];

  for (const fulfillment of fulfillments) {
    const orderId = fulfillment.__parentId;
    const order = orders.get(orderId);

    if (!order) {
      console.warn(`⚠️ Fulfillment ${fulfillment.id} has no parent order (${orderId})`);
      continue;
    }

    const orderIdNum = orderId.split('/').pop() || orderId;
    const country = order.shippingAddress?.countryCode || 'DK';
    const carrier = fulfillment.trackingInfo?.company || 'Unknown';
    const date = fulfillment.createdAt;

    // For item_count, we'll use REST API approach or set to 1 (minimum)
    // Bulk API doesn't give us fulfillmentLineItems when querying through orders
    const itemCount = 1; // Default - can be updated via separate sync if needed

    fulfillmentRecords.push({
      order_id: orderIdNum,
      date: date,
      country: country,
      carrier: carrier,
      item_count: itemCount,
    });
  }

  console.log(`✅ Transformed ${fulfillmentRecords.length} fulfillment records`);
  return fulfillmentRecords;
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
