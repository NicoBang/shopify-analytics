import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function with orchestration support
const SHOPIFY_API_VERSION = "2024-10";
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_ATTEMPTS = 180;
const BATCH_SIZE = 500;

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
}

// ✅ explicit Deno.env fallback for local Supabase CLI
serve(async (req: Request): Promise<Response> => {
  const env = Deno.env.toObject();
  const authHeader = req.headers.get("Authorization") || "";
  const invokerKey =
    env["FUNCTIONS_INVOKER_KEY"] ||
    Deno.env.get("FUNCTIONS_INVOKER_KEY") ||
    env["API_SECRET_KEY"]; // fallback just in case

  // Strict Bearer token match for function-to-function communication
  if (!invokerKey || authHeader !== `Bearer ${invokerKey}`) {
    console.error("❌ Unauthorized — missing or wrong key");
    console.error(`   Expected: Bearer ${invokerKey}`);
    console.error(`   Received: ${authHeader}`);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { shop, startDate, endDate, includeRefunds = false }: BulkSyncRequest = body;
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = getShopifyToken(shop);
    if (!token) throw new Error(`No Shopify token found for shop ${shop}`);

    const days = generateDailyIntervals(startDate, endDate);
    const results: any[] = [];

    for (const day of days) {
      console.log(`🔄 Syncing SKUs for ${day.date}`);
      const res = await syncSkusForDay(shop, token, supabase, day.startISO, day.endISO);
      results.push(res);
    }

    const skuSyncResult = { success: true, results };

    // 🎯 Sequential orchestration: call bulk-sync-refunds if requested
    if (includeRefunds) {
      console.log("📦 Starting refund sync after SKU sync...");

      try {
        const refundSyncResult = await syncRefunds(shop, startDate, endDate, invokerKey);

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

    return new Response(JSON.stringify(skuSyncResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal Error" }),
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

  // 🌍 Build country mapping from Orders (Order → LineItem relation)
  const countryMap = new Map<string, string>();
  for (const line of lines) {
    const obj = JSON.parse(line);
    // Orders don't have __parentId, LineItems do
    if (!obj.__parentId && obj.id && obj.shippingAddress?.countryCode) {
      const orderId = obj.id.split("/").pop();
      countryMap.set(orderId, obj.shippingAddress.countryCode);
    }
  }
  console.log(`🌍 Country mapping built: ${countryMap.size} orders with country data`);

  let lineItemsFound = 0;
  for (const line of lines) {
    const obj = JSON.parse(line);

    // Shopify Bulk API JSONL does NOT include __typename
    // LineItems have __parentId (references Order), Orders don't
    if (!obj.__parentId || !obj.sku) continue;

    lineItemsFound++;

    const price = parseFloat(obj.discountedUnitPriceSet?.shopMoney?.amount || "0");
    const currency = obj.discountedUnitPriceSet?.shopMoney?.currencyCode || "DKK";
    const rate = CURRENCY_RATES[currency] || 1;
    const taxRate = obj.taxLines?.[0]?.rate || 0;

    const priceDkk = price * rate / (1 + taxRate);
    const totalDiscountDkk = parseFloat(obj.totalDiscountSet?.shopMoney?.amount || "0") * rate / (1 + taxRate);
    const orderId = obj.__parentId?.split("/").pop();

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
      country: countryMap.get(orderId) || null,
      refunded_qty: 0,
      refund_date: null,
      cancelled_qty: 0,
      cancelled_amount_dkk: 0,
      created_at: new Date().toISOString(),
    });

    if (batch.length >= BATCH_SIZE) {
      await upsertSkus(supabase, batch);
      skusCount += batch.length;
      batch.length = 0;
    }
  }

  console.log(`✅ LineItems found and processed: ${lineItemsFound}`);

  if (batch.length > 0) {
    await upsertSkus(supabase, batch);
    skusCount += batch.length;
  }

  console.log(`💾 Total SKUs upserted to database: ${skusCount}`);

  return {
    day: startISO.split("T")[0],
    status: "success",
    skusProcessed: skusCount,
  };
}

async function upsertSkus(supabase: any, skus: any[]) {
  console.log(`💾 Attempting to upsert ${skus.length} SKUs to database...`);
  console.log(`🔍 First SKU sample:`, JSON.stringify(skus[0], null, 2));

  // 🧩 Aggregate duplicates to prevent "ON CONFLICT DO UPDATE command cannot affect row a second time"
  const aggregated = Object.values(
    skus.reduce((acc, item) => {
      const key = `${item.shop}-${item.order_id}-${item.sku}`;
      if (!acc[key]) {
        acc[key] = { ...item };
      } else {
        // Sum numeric fields for duplicate SKUs
        acc[key].quantity += item.quantity || 0;
        acc[key].total_discount_dkk += item.total_discount_dkk || 0;
        acc[key].refunded_qty += item.refunded_qty || 0;
        acc[key].cancelled_qty += item.cancelled_qty || 0;
        acc[key].cancelled_amount_dkk += item.cancelled_amount_dkk || 0;

        // Keep latest refund_date
        if (item.refund_date && (!acc[key].refund_date || new Date(item.refund_date) > new Date(acc[key].refund_date))) {
          acc[key].refund_date = item.refund_date;
        }

        // Recalculate per-unit discount after aggregation
        acc[key].discount_per_unit_dkk = acc[key].total_discount_dkk / (acc[key].quantity || 1);
      }
      return acc;
    }, {})
  );

  console.log(`🧩 Aggregated SKUs: ${aggregated.length} (from ${skus.length} raw entries)`);

  const { data, error } = await supabase
    .from("skus")
    .upsert(aggregated, { onConflict: "shop,order_id,sku" });

  if (error) {
    console.error(`❌ Supabase upsert error:`, JSON.stringify(error, null, 2));
    throw new Error(`Failed upsert SKUs: ${error.message}`);
  }

  console.log(`✅ Successfully upserted ${aggregated.length} SKUs`);
}

async function syncRefunds(
  shop: string,
  startDate: string,
  endDate: string,
  invokerKey: string
): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const refundEndpoint = `${supabaseUrl}/functions/v1/bulk-sync-refunds`;

  console.log(`🌐 Calling bulk-sync-refunds endpoint: ${refundEndpoint}`);

  const response = await fetch(refundEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${invokerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shop,
      startDate,
      endDate,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Refund sync failed with status ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  // Calculate totals from results array
  const totals = result.results?.reduce(
    (acc: any, day: any) => {
      acc.refundsProcessed += day.refundsProcessed || 0;
      acc.skusUpdated += day.skusUpdated || 0;
      return acc;
    },
    { refundsProcessed: 0, skusUpdated: 0 }
  );

  console.log(`📊 Refund sync totals: ${totals.refundsProcessed} refunds processed, ${totals.skusUpdated} SKUs updated`);

  return totals;
}