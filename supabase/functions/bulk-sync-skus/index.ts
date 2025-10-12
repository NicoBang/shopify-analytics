import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function with orchestration support
const SHOPIFY_API_VERSION = "2024-10";
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_ATTEMPTS = 720; // 2 hours max (720 * 10s)
const BATCH_SIZE = 500;
const EDGE_FUNCTION_TIMEOUT_MS = 300000; // 5 minutes (Edge Functions have ~6-7 min hard limit)

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
  includeRefunds?: boolean;
  targetTable?: "skus" | "sku_price_verification";  // ✅ Support verification table
  filterQuantity?: number;  // ✅ Optional: only sync quantity > filterQuantity
  testMode?: boolean;  // ✅ Skip job logging in test mode
}

interface BulkSyncJob {
  shop: string;
  object_type: "skus";
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "completed" | "failed";
  records_processed?: number;
  error_message?: string;
}

// Job logging helper functions
async function createJobLog(
  supabase: any,
  jobData: BulkSyncJob,
  testMode: boolean
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  if (testMode) {
    console.log("[TEST MODE] Skipping job log creation");
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
    console.error("⚠️ Failed to create job log:", error.message);
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

// ✅ explicit Deno.env fallback for local Supabase CLI
serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const {
      shop,
      startDate,
      endDate,
      includeRefunds = false,
      targetTable = "skus",
      filterQuantity = 0,
      testMode = false
    }: BulkSyncRequest = body;
    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, startDate, endDate",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🔑 Using Supabase key prefix:", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.substring(0, 12));

    const token = getShopifyToken(shop);
    if (!token) throw new Error(`No Shopify token found for shop ${shop}`);

    // === 🧹 Step 1: Auto-cleanup stale running jobs (older than 10 min) ===
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        error_message: "Auto-cleanup: running > 10 min",
      })
      .eq("object_type", "skus")
      .eq("status", "running")
      .lt("started_at", tenMinutesAgo);

    // === 🔍 Step 2: Check for other concurrent running SKU jobs ===
    const { data: runningJobs, error: checkError } = await supabase
      .from("bulk_sync_jobs")
      .select("id, shop, start_date, status")
      .eq("shop", shop)
      .eq("object_type", "skus")
      .eq("status", "running");

    if (checkError) console.warn("⚠️ Failed to check running jobs:", checkError.message);

    if (runningJobs && runningJobs.length > 0) {
      console.log(`⏸️ Skipping SKU sync for ${shop} — another SKU job already running`);
      return new Response(
        JSON.stringify({ error: "Another SKU job already running", jobId: runningJobs[0].id }),
        { status: 409 }
      );
    }

    // === ✅ Step 3: Create job log ===
    const jobLogResult = await createJobLog(
      supabase,
      {
        shop,
        object_type: "skus",
        start_date: startDate,
        end_date: endDate,
        status: "running",
      },
      testMode
    );

    if (!jobLogResult.success) {
      throw new Error(`Failed to create job log: ${jobLogResult.error}`);
    }

    const jobId = jobLogResult.jobId;

    const days = generateDailyIntervals(startDate, endDate);
    const results: any[] = [];
    const startTime = Date.now();

    for (let i = 0; i < days.length; i++) {
      const day = days[i];

      // Check if approaching Edge Function timeout
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > EDGE_FUNCTION_TIMEOUT_MS) {
        console.log(`⚠️ Approaching Edge Function timeout (${elapsedMs}ms elapsed). Stopping gracefully.`);

        const skusProcessed = results.reduce((sum, r) => sum + (r.skusProcessed || 0), 0);

        // Update job status to failed
        if (jobId) {
          await updateJobStatus(
            supabase,
            jobId,
            {
              status: "failed",
              records_processed: skusProcessed,
              error_message: `Edge Function timeout after ${elapsedMs}ms - processed ${i}/${days.length} days`,
            },
            testMode
          );
        }

        return new Response(
          JSON.stringify({
            success: false,
            error: "Edge Function timeout",
            daysProcessed: i,
            totalDays: days.length,
            skusProcessed,
            message: `Processed ${i}/${days.length} days before timeout`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`🔄 Syncing SKUs for ${day.date} (${i + 1}/${days.length})`);
      const res = await syncSkusForDay(shop, token, supabase, day.startISO, day.endISO);
      results.push(res);
    }

    const totalSkusProcessed = results.reduce((sum, r) => sum + (r.skusProcessed || 0), 0);
    const skuSyncResult = { success: true, results, skusProcessed: totalSkusProcessed };

    // Update job status to completed
    if (jobId) {
      await updateJobStatus(
        supabase,
        jobId,
        {
          status: "completed",
          records_processed: totalSkusProcessed,
        },
        testMode
      );
    }

    // 🎯 Sequential orchestration: call bulk-sync-refunds if requested
    if (includeRefunds) {
      console.log("📦 Starting refund sync after SKU sync...");

      try {
        const refundSyncResult = await syncRefunds(shop, startDate, endDate);

        console.log("✅ Refund sync complete:", JSON.stringify(refundSyncResult, null, 2));

        return new Response(
          JSON.stringify({
            success: true,
            skuSync: skuSyncResult,
            refundSync: refundSyncResult,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (refundError: any) {
        console.error("❌ Refund sync failed:", refundError.message);

        return new Response(
          JSON.stringify({
            success: false,
            stage: "refunds",
            skuSync: skuSyncResult,
            refundError: refundError.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Refresh materialized view for order existence checks
    try {
      console.log("🔄 Refreshing skus_order_index materialized view...");
      const { error: refreshError } = await supabase.rpc('refresh_skus_order_index');

      if (refreshError) {
        console.error("⚠️ Failed to refresh skus_order_index:", refreshError.message);
      } else {
        console.log("✅ skus_order_index refreshed successfully");
      }
    } catch (refreshError: any) {
      console.error("⚠️ Failed to refresh skus_order_index:", refreshError.message);
    }

    return new Response(JSON.stringify(skuSyncResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Function error:", err);

    // Update job status to failed if we have a jobId
    const errorMessage = err.message || "Internal Error";

    // Try to get supabase client for error logging
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const body = await req.json().catch(() => ({}));
      const testMode = body.testMode || false;

      // If we can extract shop/dates from body, create a failed job log
      if (body.shop && body.startDate && body.endDate) {
        await createJobLog(
          supabase,
          {
            shop: body.shop,
            object_type: "skus",
            start_date: body.startDate,
            end_date: body.endDate,
            status: "failed",
            error_message: errorMessage.substring(0, 500),
          },
          testMode
        );
      }
    } catch (logError) {
      console.error("⚠️ Failed to log error to bulk_sync_jobs:", logError);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function getShopifyToken(shop: string): string | null {
  const map: Record<string, string> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA") || "",
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE") || "",
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL") || "",
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT") || "",
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF") || "",
  };
  return map[shop] || null;
}

function generateDailyIntervals(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days: { date: string; startISO: string; endISO: string }[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split("T")[0];
    days.push({
      date,
      startISO: `${date}T00:00:00Z`,
      endISO: `${date}T23:59:59Z`,
    });
  }
  return days;
}

async function syncSkusForDay(
  shop: string,
  token: string,
  supabase: any,
  startISO: string,
  endISO: string
): Promise<{ day: string; status: string; skusProcessed: number }> {
  // ✅ SHOPIFY BULK API CRITICAL RULES:
  // 1. Connection fields MUST use edges { node { ... } }
  // 2. Nested connections (connection within list) are NOT supported
  // 3. SOLUTION: Query lineItems only, refunds require separate query
  // 4. Refunds.refundLineItems is a connection within a list, violates Bulk API rules
  const bulkQuery = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(query: "created_at:>='${startISO}' AND created_at:<='${endISO}'") {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                currencyCode
                taxesIncluded
                shippingAddress { countryCode }
                subtotalPriceSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                taxLines {
                  rate
                  title
                  ratePercentage
                  priceSet { shopMoney { amount } }
                }
                lineItems {
                  edges {
                    node {
                      id
                      sku
                      quantity
                      name
                      variantTitle
                      product { title }
                      originalUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                      discountedUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                      totalDiscountSet {
                        shopMoney { amount currencyCode }
                      }
                      variant {
                        compareAtPrice
                      }
                      taxLines {
                        rate
                        priceSet { shopMoney { amount } }
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
        bulkOperation { id status }
        userErrors { field message }
      }
    }
  `;

  console.log(`📤 Starting bulk operation for ${startISO.split("T")[0]}`);
  console.log(`🔍 Full Bulk Query:\n${bulkQuery}\n`);

  const resp = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: bulkQuery }),
    }
  );

  const parsed = await resp.json();

  // 🆕 ADDED: Log full Shopify response for debugging
  console.log("📥 Shopify bulkOperationRunQuery response:", JSON.stringify(parsed, null, 2));

  const userErrors = parsed?.data?.bulkOperationRunQuery?.userErrors;
  if (userErrors && userErrors.length > 0) {
    console.error("❌ Shopify userErrors:", JSON.stringify(userErrors, null, 2));
    throw new Error(`Shopify userErrors: ${JSON.stringify(userErrors)}`);
  }

  const bulkOp = parsed?.data?.bulkOperationRunQuery?.bulkOperation;
  const bulkId = bulkOp?.id;

  // 🆕 ADDED: Log bulk operation details
  console.log("🆔 Bulk operation created:", { id: bulkId, status: bulkOp?.status });

  if (!bulkId) {
    console.error("❌ No bulkId in response. Full parsed response:", JSON.stringify(parsed, null, 2));
    throw new Error("bulkOperationRunQuery did not return id");
  }

  let fileUrl: string | null = null;
  console.log(`⏳ Polling bulk operation status (max ${MAX_POLL_ATTEMPTS} attempts, ${POLL_INTERVAL_MS}ms interval)...`);

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const pollResp = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: `{
            currentBulkOperation {
              id status errorCode url objectCount
            }
          }`,
        }),
      }
    );

    const pollParsed = await pollResp.json();
    const op = pollParsed?.data?.currentBulkOperation;

    if (!op) {
      console.log(`  Poll ${i + 1}: No current bulk operation found, waiting...`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    console.log(`  Poll ${i + 1}: status=${op.status}, objectCount=${op.objectCount || 0}`);

    if (op.status === "COMPLETED") {
      console.log(`✅ Bulk operation completed! Objects: ${op.objectCount}, URL: ${op.url}`);
      fileUrl = op.url;
      break;
    }

    if (op.status === "FAILED") {
      console.error(`❌ Bulk operation failed with errorCode: ${op.errorCode}`);
      throw new Error(`Bulk operation failed: ${op.errorCode}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!fileUrl) {
    console.error(`❌ Polling timeout after ${MAX_POLL_ATTEMPTS} attempts`);
    throw new Error("Polling timed out before completion");
  }

  const fileResp = await fetch(fileUrl);
  const text = await fileResp.text();
  const lines = text.split("\n").filter((l) => l.trim());
  let skusCount = 0;
  const batch: any[] = [];

  console.log(`📦 Total JSONL lines received: ${lines.length}`);

  // Log first 5 lines with full content to understand structure
  if (lines.length > 0) {
    console.log("📋 First 5 JSONL lines (full content):");
    lines.slice(0, 5).forEach((line, idx) => {
      console.log(`\n  --- Line ${idx + 1} ---`);
      console.log(line);
    });
    console.log("\n");
  }

  // 🌍 Build order metadata mapping from Orders (Order → LineItem relation)
  const orderMetadataMap = new Map<string, { country: string | null; createdAt: string; subtotal: string | null; totalTax: string | null; taxRate: number | null }>();
  for (const line of lines) {
    const obj = JSON.parse(line);
    // Orders don't have __parentId, LineItems do
    if (!obj.__parentId && obj.id) {
      const orderId = obj.id.split("/").pop();

      // ⚠️ CRITICAL: createdAt must ALWAYS come from Shopify order data
      if (!obj.createdAt) {
        console.warn(`[WARN] Missing created_at on order ${orderId}`);
      }

      // Extract tax rate from order's taxLines (use first tax line)
      let taxRate: number | null = null;
      if (obj.taxLines && obj.taxLines.length > 0) {
        taxRate = obj.taxLines[0].rate; // Decimal format (0.25 = 25%)
      }

      orderMetadataMap.set(orderId, {
        country: obj.shippingAddress?.countryCode || null,
        createdAt: obj.createdAt,
        subtotal: obj.subtotalPriceSet?.shopMoney?.amount || null,
        totalTax: obj.totalTaxSet?.shopMoney?.amount || null,
        taxRate: taxRate,
      });
    }
  }
  console.log(`🌍 Order metadata mapping built: ${orderMetadataMap.size} orders`);

  let lineItemsFound = 0;
  for (const line of lines) {
    const obj = JSON.parse(line);

    // Shopify Bulk API JSONL does NOT include __typename
    // LineItems have __parentId (references Order), Orders don't
    if (!obj.__parentId || !obj.sku) continue;

    lineItemsFound++;

    const orderId = obj.__parentId?.split("/").pop();
    const orderMetadata = orderMetadataMap.get(orderId);

    const price = parseFloat(obj.discountedUnitPriceSet?.shopMoney?.amount || "0");
    const originalPrice = parseFloat(obj.originalUnitPriceSet?.shopMoney?.amount || "0");
    const compareAtPrice = parseFloat(obj.variant?.compareAtPrice || "0");
    const currency = obj.discountedUnitPriceSet?.shopMoney?.currencyCode || "DKK";
    const rate = CURRENCY_RATES[currency] || 1;

    // ✅ Calculate price_dkk using tax_rate (not Shopify's rounded taxLines)
    // This ensures accurate ex-VAT pricing without rounding errors
    const taxRate = orderMetadata?.taxRate;
    let priceDkk: number;

    if (taxRate !== null && taxRate !== undefined) {
      // Convert INCL VAT to EX VAT using actual tax rate
      const priceInclVat = price * rate; // Price in DKK including VAT
      const priceExVat = priceInclVat / (1 + taxRate); // Price in DKK excluding VAT
      priceDkk = priceExVat;
    } else {
      // Fallback: use old method with taxLines if no tax_rate available
      const taxLinesArray = Array.isArray(obj.taxLines) ? obj.taxLines : (obj.taxLines?.edges?.map((e: any) => e.node) || []);
      let totalTaxPerUnit = 0;

      if (taxLinesArray.length > 0) {
        const totalTaxForAllUnits = taxLinesArray.reduce((sum: number, taxLine: any) => {
          const taxAmount = parseFloat(taxLine.priceSet?.shopMoney?.amount || "0");
          return sum + taxAmount;
        }, 0) * rate;
        totalTaxPerUnit = totalTaxForAllUnits / (obj.quantity || 1);
      } else if (orderMetadata?.totalTax && orderMetadata?.subtotal) {
        const itemProportion = price / parseFloat(orderMetadata.subtotal);
        totalTaxPerUnit = parseFloat(orderMetadata.totalTax) * itemProportion * rate;
      }
      priceDkk = (price * rate) - totalTaxPerUnit;
    }
    const totalDiscountRaw = parseFloat(obj.totalDiscountSet?.shopMoney?.amount || "0") * rate;

    // Calculate tax on discount using tax_rate
    let totalDiscountDkk: number;
    if (taxRate !== null && taxRate !== undefined) {
      // Discount is INCL VAT, convert to EX VAT
      totalDiscountDkk = totalDiscountRaw / (1 + taxRate);
    } else {
      // Fallback: proportional method
      const totalTaxPerUnit = (price * rate) - priceDkk; // Tax amount
      const discountTax = totalDiscountRaw > 0 && price > 0 ? (totalTaxPerUnit * totalDiscountRaw / (price * rate)) : 0;
      totalDiscountDkk = totalDiscountRaw - discountTax;
    }

    // ✅ SOLUTION: Calculate order-level discounts from Shopify LineItem data
    //
    // ORDER-LEVEL DISCOUNT (from Shopify):
    // - originalUnitPriceSet = price before order-level discounts (coupon codes, automatic discounts)
    // - discountedUnitPriceSet = final price customer pays
    // - Order discount = originalUnitPrice - discountedUnitPrice
    //
    // SALE/CAMPAIGN DISCOUNT (from product_metadata):
    // - Will be calculated AFTER upsert via updateOriginalPricesFromMetadata()
    // - product_metadata has historical compareAt prices
    // - We'll convert to ex VAT before comparison
    //
    // NOTE: Shopify's variant.compareAtPrice returns CURRENT price, not historical
    // Therefore we cannot use it for historical orders - must use product_metadata
    let originalPriceDkk = 0;
    if (originalPrice > 0) {
      if (taxRate !== null && taxRate !== undefined) {
        // Convert INCL VAT to EX VAT using tax_rate
        originalPriceDkk = (originalPrice * rate) / (1 + taxRate);
      } else {
        // Fallback: calculate tax amount
        const totalTaxPerUnit = (price * rate) - priceDkk;
        originalPriceDkk = (originalPrice * rate) - totalTaxPerUnit;
      }
    }

    // For now, set these to 0 - will be calculated from product_metadata
    const saleDiscountPerUnit = 0;
    const saleDiscountTotal = 0;

    // ✅ ALWAYS use Shopify's order creation timestamp
    const shopifyCreatedAt = orderMetadata?.createdAt;

    if (!shopifyCreatedAt) {
      console.error(`[ERROR] Missing Shopify createdAt for order ${orderId} - SKU will be skipped`);
      continue; // Skip this SKU if we don't have the actual order date
    }

    // CRITICAL: skus.created_at is DATE (not TIMESTAMPTZ)
    // Must use "YYYY-MM-DD" format as per CLAUDE.md rules
    const created_at = new Date(shopifyCreatedAt).toISOString().split("T")[0];

    // NOTE: Refund fields (refunded_qty, refund_date, cancelled_qty, etc.) are NOT set here
    // They are exclusively managed by bulk-sync-refunds function
    batch.push({
      shop,
      order_id: orderId,
      sku: obj.sku,
      product_title: obj.name,
      variant_title: obj.variantTitle,
      quantity: obj.quantity,
      price_dkk: priceDkk,
      total_discount_dkk: totalDiscountDkk,
      discount_per_unit_dkk: totalDiscountDkk / (obj.quantity || 1),
      original_price_dkk: originalPriceDkk, // ✅ SOLUTION 1: Use Shopify's originalUnitPriceSet
      sale_discount_per_unit_dkk: saleDiscountPerUnit,
      sale_discount_total_dkk: saleDiscountTotal,
      country: orderMetadata?.country || null,
      created_at: created_at, // DATE format: "YYYY-MM-DD"
      created_at_original: shopifyCreatedAt, // TIMESTAMPTZ: full Shopify order timestamp
      tax_rate: orderMetadata?.taxRate || null, // VAT rate from order taxLines
    });

    if (batch.length >= BATCH_SIZE) {
      skusCount += await upsertSkus(supabase, batch);
      batch.length = 0;
    }
  }

  console.log(`✅ LineItems found and processed: ${lineItemsFound}`);

  if (batch.length > 0) {
    skusCount += await upsertSkus(supabase, batch);
  }

  console.log(`💾 Total SKUs upserted to database: ${skusCount}`);

  // ✅ Update sale discounts from product_metadata (all shops)
  if (skusCount > 0) {
    console.log(`\n🔄 Updating original_price_dkk from product_metadata...`);
    await updateOriginalPricesFromMetadata(supabase, shop, startISO.split("T")[0]);
  }

  return {
    day: startISO.split("T")[0],
    status: "success",
    skusProcessed: skusCount,
  };
}

async function upsertSkus(supabase: any, skus: any[], targetTable: string = "skus", filterQuantity: number = 0) {
  // ✅ Filter by quantity if requested
  const filteredSkus = filterQuantity > 0
    ? skus.filter(sku => sku.quantity > filterQuantity)
    : skus;

  if (filteredSkus.length === 0) {
    console.log(`⏭️  No SKUs match filter (quantity > ${filterQuantity}), skipping upsert`);
    return 0; // Return 0 affected
  }

  console.log(`💾 Attempting to upsert ${filteredSkus.length} SKUs to ${targetTable}...`);
  if (filterQuantity > 0) {
    console.log(`   Filtered from ${skus.length} (only quantity > ${filterQuantity})`);
  }
  console.log(`🔍 First SKU sample:`, JSON.stringify(filteredSkus[0], null, 2));

  // 🧩 Aggregate duplicates to prevent "ON CONFLICT DO UPDATE command cannot affect row a second time"
  const aggregated = Object.values(
    filteredSkus.reduce((acc, item) => {
      const key = `${item.shop}-${item.order_id}-${item.sku}`;
      if (!acc[key]) {
        acc[key] = { ...item };
      } else {
        // Sum numeric fields for duplicate SKUs
        acc[key].quantity += item.quantity || 0;
        acc[key].total_discount_dkk += item.total_discount_dkk || 0;

        // NOTE: Refund fields (refunded_qty, cancelled_qty, etc.) are NOT aggregated here
        // They are exclusively managed by bulk-sync-refunds function

        // Recalculate per-unit discount after aggregation
        acc[key].discount_per_unit_dkk = acc[key].total_discount_dkk / (acc[key].quantity || 1);
      }
      return acc;
    }, {})
  );

  console.log(`🧩 Aggregated SKUs: ${aggregated.length} (from ${filteredSkus.length} raw entries)`);

  // Log first SKU for debugging
  if (aggregated.length > 0) {
    console.log(`📝 Sample SKU:`, JSON.stringify(aggregated[0]).substring(0, 300));
  }

  console.log(`📤 Starting upsert of ${aggregated.length} SKUs to ${targetTable}...`);

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { data, error } = await supabase
      .from(targetTable)
      .upsert(aggregated, { onConflict: "shop,order_id,sku" })
      .select();

    if (error) {
      console.error(`❌ Batch failed (attempt ${attempt}): ${error.message}`);
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, attempt * 1000));
    } else {
      const affected = data?.length || 0;
      if (affected === 0)
        console.warn(`⚠️ No matching rows found in batch`);
      console.log(`✅ Batch updated ${affected} rows`);
      return affected;
    }
  }

  throw new Error(`Failed to upsert after ${MAX_RETRIES} attempts`);
}

/**
 * Update original_price_dkk and sale_discount fields using product_metadata
 * CRITICAL: Convert product_metadata prices to ex VAT before comparison
 * Multi-currency support: DK uses product_metadata, EUR shops use product_metadata_eur, CHF uses product_metadata_chf
 */
async function updateOriginalPricesFromMetadata(
  supabase: SupabaseClient,
  shop: string,
  startDate: string
): Promise<void> {
  console.log(`\n🔄 Updating sale discounts from product_metadata for ${shop} on ${startDate}...`);

  // Determine metadata table and VAT rate based on shop
  let metadataTable: string;
  let vatRate: number;

  if (shop === 'pompdelux-da.myshopify.com') {
    metadataTable = 'product_metadata';
    vatRate = 1.25; // DK: 25% VAT
  } else if (shop === 'pompdelux-chf.myshopify.com') {
    metadataTable = 'product_metadata_chf';
    vatRate = 1.077; // CHF: 7.7% VAT
  } else {
    // pompdelux-de, pompdelux-nl, pompdelux-int
    metadataTable = 'product_metadata_eur';
    vatRate = 1.25; // EUR: 25% VAT (Denmark standard for these shops)
  }

  console.log(`📋 Using metadata table: ${metadataTable} with VAT rate: ${vatRate}`);

  // Step 1: Get SKUs for this day
  const { data: skus, error: fetchError } = await supabase
    .from('skus')
    .select('shop, order_id, sku, price_dkk, quantity')
    .eq('shop', shop)
    .eq('created_at_original', startDate);

  if (fetchError) {
    console.error(`❌ Error fetching SKUs:`, fetchError);
    throw fetchError;
  }

  if (!skus || skus.length === 0) {
    console.log(`ℹ️ No SKUs found for ${shop} on ${startDate}`);
    return;
  }

  console.log(`📊 Found ${skus.length} SKUs to check against ${metadataTable}`);

  // Step 1.5: Get tax_rate from orders for these SKUs
  const orderIds = [...new Set(skus.map(s => s.order_id))];
  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('order_id, tax_rate')
    .eq('shop', shop)
    .in('order_id', orderIds);

  if (orderError) {
    console.error(`❌ Error fetching orders:`, orderError);
    throw orderError;
  }

  const taxRateMap = new Map(orders?.map(o => [o.order_id, o.tax_rate]) || []);
  console.log(`📊 Found tax rates for ${taxRateMap.size} orders`);

  // Step 2: Get product_metadata for these SKUs
  const skuList = skus.map(s => s.sku);
  const { data: metadata, error: metaError } = await supabase
    .from(metadataTable)
    .select('sku, price, compare_at_price')
    .in('sku', skuList);

  if (metaError) {
    console.error(`❌ Error fetching ${metadataTable}:`, metaError);
    throw metaError;
  }

  if (!metadata || metadata.length === 0) {
    console.log(`ℹ️ No ${metadataTable} found for these SKUs`);
    return;
  }

  console.log(`📊 Found ${metadata.length} products in ${metadataTable}`);

  // Step 3: Join SKUs with metadata and calculate discounts
  const metadataMap = new Map(metadata.map(m => [m.sku, m]));

  const updates = skus
    .filter(sku => metadataMap.has(sku.sku))
    .map((sku: any) => {
      const pm = metadataMap.get(sku.sku)!;

      // Get actual tax_rate from order (fallback to default vatRate if null)
      const actualTaxRate = taxRateMap.get(sku.order_id);
      const effectiveVatMultiplier = actualTaxRate !== null && actualTaxRate !== undefined
        ? (1 + actualTaxRate)  // Use actual tax rate from order
        : vatRate;              // Fallback to default VAT rate

      // Convert from INCL VAT to EX VAT using actual tax rate
      const compareAtPriceExVat = (pm.compare_at_price || 0) / effectiveVatMultiplier;
      const priceExVat = (pm.price || 0) / effectiveVatMultiplier;

      // Original price = MAX(compareAt, price) converted to ex VAT
      const originalPriceDkk = compareAtPriceExVat > priceExVat ? compareAtPriceExVat : priceExVat;

      // Sale discount = original - actual selling price (both ex VAT)
      const saleDiscountPerUnit = Math.max(originalPriceDkk - sku.price_dkk, 0);
      const saleDiscountTotal = saleDiscountPerUnit * sku.quantity;

      return {
        shop: sku.shop,
        order_id: sku.order_id,
        sku: sku.sku,
        original_price_dkk: originalPriceDkk,
        sale_discount_per_unit_dkk: saleDiscountPerUnit,
        sale_discount_total_dkk: saleDiscountTotal,
        tax_rate: actualTaxRate  // Store tax_rate in SKU
      };
    });

  // Step 3: Batch update SKUs
  const { error: updateError } = await supabase
    .from('skus')
    .upsert(updates, { onConflict: 'shop,order_id,sku' });

  if (updateError) {
    console.error(`❌ Error updating SKUs:`, updateError);
    throw updateError;
  }

  console.log(`✅ Updated ${updates.length} SKUs with sale discounts from product_metadata`);

  // Step 4: Update orders.sale_discount_total by aggregating from skus
  console.log(`🔄 Aggregating sale_discount_total to orders table...`);
  const { error: aggError } = await supabase.rpc('update_order_sale_discount');

  if (aggError) {
    console.error(`❌ Error aggregating to orders:`, aggError);
  } else {
    console.log(`✅ Aggregated sale_discount_total to orders`);
  }
}

async function syncRefunds(
  shop: string,
  startDate: string,
  endDate: string
): Promise<any> {
  console.log(`🔄 Invoking bulk-sync-refunds via fetch...`);
  console.log(`   Shop: ${shop}`);
  console.log(`   Date range: ${startDate} to ${endDate}`);

  // Use fetch with service role key for function-to-function communication
  const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bulk-sync-refunds`;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log("🔑 Using service role key prefix:", serviceRoleKey.substring(0, 12));
  console.log(`🌐 Calling ${functionUrl}`);

  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shop,
      startDate,
      endDate,
    }),
  });

  const responseText = await response.text();
  console.log(`📥 Response status: ${response.status}`);
  console.log(`📥 Response body:`, responseText);

  if (!response.ok) {
    console.error(`❌ Refund sync HTTP error (${response.status}):`, responseText);
    throw new Error(`Refund sync failed with status ${response.status}: ${responseText}`);
  }

  const refundData = JSON.parse(responseText);
  console.log("✅ Refund orchestration complete:", refundData?.results?.length || 0, "days processed");

  // Calculate totals from results array
  const totals = refundData?.results?.reduce(
    (acc: any, day: any) => {
      acc.refundsProcessed += day.refundsProcessed || 0;
      acc.skusUpdated += day.skusUpdated || 0;
      return acc;
    },
    { refundsProcessed: 0, skusUpdated: 0 }
  ) || { refundsProcessed: 0, skusUpdated: 0 };

  console.log(`📊 Refund sync totals: ${totals.refundsProcessed} refunds processed, ${totals.skusUpdated} SKUs updated`);

  return refundData;
}