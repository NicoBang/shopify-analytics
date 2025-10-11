// Shopify Order Sequence Sync
// Purpose: Fetch sequential order numbers from Shopify to populate order_sequence_validation
// This provides the "source of truth" for detecting missing orders
// Separate from orders/skus sync - only fetches: shop, orderNumber, order_id, createdAt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SHOPIFY_CONFIG } from "../_shared/config.ts";
import { getShopifyToken as getToken, withRetry } from "../_shared/shopify.ts";
import { createAuthenticatedClient, batchUpsert } from "../_shared/supabase.ts";

// Bulk Operations Configuration
const POLL_INTERVAL_MS = 10000; // 10 seconds
const MAX_POLL_ATTEMPTS = 360; // 1 hour max
const BATCH_SIZE = 1000; // Supabase batch insert size

interface SyncRequest {
  shop?: string; // If omitted, syncs all shops
  startDate?: string; // Optional date filter (ISO format)
  endDate?: string;
  testMode?: boolean;
}

interface OrderSequenceRecord {
  shop: string;
  shopify_order_number: number;
  order_id: number;
  created_at: string; // ISO timestamp from Shopify
  exists_in_orders: boolean;
  exists_in_skus: boolean;
}

serve(async (req) => {
  try {
    const { shop, startDate, endDate, testMode = false }: SyncRequest = await req.json();

    // Determine which shops to sync
    const shopsToSync = shop ? [shop] : Object.keys(SHOPIFY_CONFIG);

    console.log(`🔢 Starting order sequence sync for ${shopsToSync.length} shop(s)${testMode ? ' [TEST MODE]' : ''}`);
    if (startDate || endDate) {
      console.log(`📅 Date filter: ${startDate || 'beginning'} to ${endDate || 'now'}`);
    }

    const supabase = createAuthenticatedClient();
    const results = [];

    for (const shopName of shopsToSync) {
      try {
        const shopResult = await syncShopOrderSequences({
          shop: shopName,
          startDate,
          endDate,
          supabase,
          testMode,
        });
        results.push(shopResult);
      } catch (error) {
        console.error(`❌ Failed to sync ${shopName}:`, error);
        let errorMessage = "Unknown error";
        let errorDetails = null;

        if (error instanceof Error) {
          errorMessage = error.message;
          errorDetails = error.stack;
        } else if (typeof error === "object" && error !== null) {
          errorMessage = JSON.stringify(error);
        } else {
          errorMessage = String(error);
        }

        console.error("Error details:", errorMessage);
        console.error("Error stack:", errorDetails);

        results.push({
          shop: shopName,
          success: false,
          error: errorMessage,
          details: errorDetails,
        });
      }
    }

    const totalRecords = results.reduce((sum, r) => sum + (r.recordsInserted || 0), 0);
    const hasErrors = results.some(r => !r.success);

    return new Response(
      JSON.stringify({
        success: !hasErrors,
        totalRecords,
        results,
        testMode,
      }),
      { status: hasErrors ? 207 : 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Fatal error in sync-order-sequences:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function syncShopOrderSequences({
  shop,
  startDate,
  endDate,
  supabase,
  testMode,
}: {
  shop: string;
  startDate?: string;
  endDate?: string;
  supabase: any;
  testMode: boolean;
}) {
  console.log(`\n📊 Syncing order sequences for ${shop}`);

  const shopifyToken = getToken(shop);
  const shopifyDomain = SHOPIFY_CONFIG[shop]?.domain || shop;

  // Step 1: Create bulk operation
  const bulkOpId = await createBulkOperation({
    shop: shopifyDomain,
    token: shopifyToken,
    startDate,
    endDate,
  });

  console.log(`🚀 Bulk operation created: ${bulkOpId}`);

  // Step 2: Poll until complete
  const bulkOpResult = await pollBulkOperation({
    shop: shopifyDomain,
    token: shopifyToken,
    bulkOpId,
  });

  if (!bulkOpResult.url) {
    throw new Error("Bulk operation failed: No download URL");
  }

  console.log(`✅ Bulk operation complete, downloading data...`);

  // Step 3: Download and parse JSONL
  const records = await downloadAndParseOrderSequences(bulkOpResult.url);

  console.log(`📥 Downloaded ${records.length} order sequences`);

  if (testMode) {
    console.log(`🧪 TEST MODE: Would insert ${records.length} records`);
    return {
      shop,
      success: true,
      recordsInserted: records.length,
      testMode: true,
      sampleRecords: records.slice(0, 5),
    };
  }

  // Step 4: Check which orders exist in orders/skus tables
  const enrichedRecords = await enrichWithExistenceFlags(supabase, shop, records);

  // Step 5: Batch insert to order_sequence_validation
  const insertedCount = await batchInsertOrderSequences(supabase, enrichedRecords);

  console.log(`✅ Inserted/updated ${insertedCount} records for ${shop}`);

  // Step 6: Refresh existence flags for ALL existing records
  console.log(`🔄 Refreshing existence flags for all existing records...`);
  const refreshCount = await refreshAllExistenceFlags(supabase, shop);
  console.log(`✅ Refreshed ${refreshCount} existing records`);

  return {
    shop,
    success: true,
    recordsInserted: insertedCount,
    recordsRefreshed: refreshCount,
    totalRecords: records.length,
  };
}

async function createBulkOperation({
  shop,
  token,
  startDate,
  endDate,
}: {
  shop: string;
  token: string;
  startDate?: string;
  endDate?: string;
}): Promise<string> {
  // Build date query filter - Shopify requires ISO timestamps with timezone
  let dateQuery = "";
  if (startDate && endDate) {
    // Convert dates to ISO timestamps if needed
    const start = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const end = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;
    dateQuery = `created_at:>='${start}' AND created_at:<='${end}'`;
  } else if (startDate) {
    const start = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    dateQuery = `created_at:>='${start}'`;
  } else if (endDate) {
    const end = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;
    dateQuery = `created_at:<='${end}'`;
  }

  // Minimal GraphQL query - only what we need for sequence validation
  const bulkQuery = dateQuery
    ? `
    {
      orders(query: "${dateQuery}") {
        edges {
          node {
            id
            name
            createdAt
          }
        }
      }
    }
  `
    : `
    {
      orders {
        edges {
          node {
            id
            name
            createdAt
          }
        }
      }
    }
  `;

  const mutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
          ${bulkQuery}
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

  const response = await withRetry(async () => {
    const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation }),
    });

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  });

  if (response.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    throw new Error(
      `Bulk operation errors: ${JSON.stringify(response.data.bulkOperationRunQuery.userErrors)}`
    );
  }

  const bulkOpId = response.data?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!bulkOpId) {
    throw new Error("Failed to create bulk operation");
  }

  return bulkOpId;
}

async function pollBulkOperation({
  shop,
  token,
  bulkOpId,
}: {
  shop: string;
  token: string;
  bulkOpId: string;
}): Promise<{ status: string; url?: string }> {
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    const query = `
      query {
        node(id: "${bulkOpId}") {
          ... on BulkOperation {
            id
            status
            errorCode
            createdAt
            completedAt
            objectCount
            fileSize
            url
            partialDataUrl
          }
        }
      }
    `;

    const response = await withRetry(async () => {
      const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
      }

      return res.json();
    });

    const bulkOp = response.data?.node;
    if (!bulkOp) {
      throw new Error("Bulk operation not found");
    }

    console.log(`📊 Bulk operation status: ${bulkOp.status} (${bulkOp.objectCount || 0} objects)`);

    if (bulkOp.status === "COMPLETED") {
      return { status: "COMPLETED", url: bulkOp.url };
    }

    if (bulkOp.status === "FAILED" || bulkOp.status === "CANCELED") {
      throw new Error(`Bulk operation ${bulkOp.status}: ${bulkOp.errorCode || "Unknown error"}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    attempts++;
  }

  throw new Error(`Bulk operation timeout after ${attempts} attempts`);
}

async function downloadAndParseOrderSequences(url: string): Promise<OrderSequenceRecord[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download bulk data: ${response.status}`);
  }

  const text = await response.text();
  const lines = text.trim().split("\n");
  const records: OrderSequenceRecord[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);

      // Only process order nodes (not edges)
      if (obj.id && obj.id.includes("/Order/")) {
        // Extract numeric order ID from gid://shopify/Order/123456
        const orderIdMatch = obj.id.match(/\/Order\/(\d+)/);
        if (!orderIdMatch) continue;

        const orderId = parseInt(orderIdMatch[1]);

        // Extract order number from name
        // Format can be: "#1234" or "1234-DA" or "1234"
        let orderNumber: number;

        // Try format with # prefix first
        let orderNumberMatch = obj.name?.match(/#(\d+)/);
        if (orderNumberMatch) {
          orderNumber = parseInt(orderNumberMatch[1]);
        } else {
          // Try format with -XX suffix (e.g., "17757-DA")
          orderNumberMatch = obj.name?.match(/(\d+)-[A-Z]{2}/);
          if (orderNumberMatch) {
            orderNumber = parseInt(orderNumberMatch[1]);
          } else {
            // Try plain number format
            orderNumberMatch = obj.name?.match(/^(\d+)$/);
            if (!orderNumberMatch) continue;
            orderNumber = parseInt(orderNumberMatch[1]);
          }
        }

        records.push({
          shop: "", // Will be set by caller
          shopify_order_number: orderNumber,
          order_id: orderId,
          created_at: obj.createdAt,
          exists_in_orders: false, // Will be enriched
          exists_in_skus: false, // Will be enriched
        });
      }
    } catch (error) {
      console.error("Failed to parse line:", line, error);
      continue;
    }
  }

  return records;
}

async function enrichWithExistenceFlags(
  supabase: any,
  shop: string,
  records: OrderSequenceRecord[]
): Promise<OrderSequenceRecord[]> {
  if (records.length === 0) return records;

  // Set shop for all records
  records.forEach(r => r.shop = shop);

  // Get all order_ids from records - ensure they're numbers
  const orderIds = records.map(r => parseInt(String(r.order_id)));

  console.log(`🔍 Checking existence for ${orderIds.length} order_ids...`);
  console.log(`📝 Sample order_ids: ${orderIds.slice(0, 5).join(", ")}`);

  // PostgreSQL .in() has limit of ~1000 items, so we batch the checks
  const batchSize = 500;
  const ordersSet = new Set<number>();
  const skusSet = new Set<number>();

  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batch = orderIds.slice(i, i + batchSize);

    console.log(`🔍 Checking batch ${Math.floor(i / batchSize) + 1}: ${batch.length} order_ids (sample: ${batch.slice(0, 3).join(", ")})`);

    // Batch check existence in orders table
    // Use select("order_id").in() which returns only matching rows
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("order_id")
      .eq("shop", shop)
      .in("order_id", batch);

    if (ordersError) {
      console.error("❌ Error checking orders:", ordersError);
      throw ordersError;
    }

    // Add to Set for O(1) lookup
    (ordersData || []).forEach((o: any) => {
      const id = parseInt(String(o.order_id));
      if (!isNaN(id)) {
        ordersSet.add(id);
      }
    });

    // Batch check existence in skus using materialized view (much faster!)
    // skus_order_index contains DISTINCT order_ids from skus table
    const { data: skusIndexData, error: skusError } = await supabase
      .from("skus_order_index")
      .select("order_id")
      .eq("shop", shop)
      .in("order_id", batch);

    if (skusError) {
      console.error("❌ Error checking skus_order_index:", skusError);
      throw skusError;
    }

    // Add to Set
    (skusIndexData || []).forEach((s: any) => {
      const id = parseInt(String(s.order_id));
      if (!isNaN(id)) {
        skusSet.add(id);
      }
    });

    console.log(`✓ Batch ${Math.floor(i / batchSize) + 1}: Found ${ordersData?.length || 0} in orders, ${skusIndexData?.length || 0} in skus_order_index`);
  }

  console.log(`📊 Found ${ordersSet.size} in orders, ${skusSet.size} in skus out of ${orderIds.length} total`);

  // Enrich records
  const enriched = records.map(record => {
    const orderId = parseInt(String(record.order_id));
    return {
      ...record,
      exists_in_orders: ordersSet.has(orderId),
      exists_in_skus: skusSet.has(orderId),
    };
  });

  // Log sample for debugging
  const sample = enriched.slice(0, 3);
  console.log(`📝 Sample enriched records:`, JSON.stringify(sample, null, 2));

  return enriched;
}

async function batchInsertOrderSequences(
  supabase: any,
  records: OrderSequenceRecord[]
): Promise<number> {
  let totalInserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("order_sequence_validation")
      .upsert(batch, {
        onConflict: "shop,shopify_order_number",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Failed to insert batch ${i}-${i + batch.length}:`, error);
      throw error;
    }

    totalInserted += batch.length;
    console.log(`📝 Inserted batch ${i + 1}-${i + batch.length} of ${records.length}`);
  }

  return totalInserted;
}

async function refreshAllExistenceFlags(
  supabase: any,
  shop: string
): Promise<number> {
  // Fetch ALL existing records for this shop (paginated)
  let allRecords: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data: pageRecords, error: fetchError } = await supabase
      .from("order_sequence_validation")
      .select("*")
      .eq("shop", shop)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (fetchError) {
      console.error("Failed to fetch existing records:", fetchError);
      throw fetchError;
    }

    if (!pageRecords || pageRecords.length === 0) break;

    allRecords = allRecords.concat(pageRecords);
    console.log(`📥 Fetched page ${page + 1}: ${pageRecords.length} records (total: ${allRecords.length})`);

    if (pageRecords.length < pageSize) break;
    page++;
  }

  if (allRecords.length === 0) {
    console.log("No existing records to refresh");
    return 0;
  }

  console.log(`🔍 Checking existence for ${allRecords.length} records...`);

  // Re-check existence flags
  const refreshedRecords = await enrichWithExistenceFlags(
    supabase,
    shop,
    allRecords
  );

  // Update records in batches
  let totalUpdated = 0;
  for (let i = 0; i < refreshedRecords.length; i += BATCH_SIZE) {
    const batch = refreshedRecords.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("order_sequence_validation")
      .upsert(batch, {
        onConflict: "shop,shopify_order_number",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Failed to update batch ${i}-${i + batch.length}:`, error);
      throw error;
    }

    totalUpdated += batch.length;
    console.log(`🔄 Refreshed batch ${i + 1}-${i + batch.length} of ${refreshedRecords.length}`);
  }

  return totalUpdated;
}
