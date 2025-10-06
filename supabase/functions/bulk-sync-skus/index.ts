import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 👇 Tilføj dette lige her:
console.log("🧪 FUNCTIONS_INVOKER_KEY (env):", Deno.env.get("FUNCTIONS_INVOKER_KEY"));

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
}

// ✅ explicit Deno.env fallback for local Supabase CLI
serve(async (req: Request): Promise<Response> => {
  const env = Deno.env.toObject();
  const authHeader = req.headers.get("Authorization") || "";
  const invokerKey =
    env["FUNCTIONS_INVOKER_KEY"] ||
    Deno.env.get("FUNCTIONS_INVOKER_KEY") ||
    env["API_SECRET_KEY"]; // fallback just in case

  console.log("🔍 Loaded env keys:", Object.keys(env)); // debugging
  console.log("🔑 Expected key:", invokerKey);

  if (!invokerKey || !authHeader.includes(invokerKey)) {
    console.error("❌ Unauthorized — missing or wrong key");
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

    const { shop, startDate, endDate }: BulkSyncRequest = body;
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

    return new Response(JSON.stringify({ success: true, results }), {
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
  // 3. SOLUTION: Only query lineItems (connection), Bulk API flattens to JSONL with __parentId
  // 4. Refunds cannot be queried here (contains nested connections refundLineItems/transactions)
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

    batch.push({
      shop,
      order_id: obj.__parentId?.split("/").pop(),
      sku: obj.sku,
      product_title: obj.name,
      variant_title: obj.variantTitle,
      quantity: obj.quantity,
      price_dkk: priceDkk,
      total_discount_dkk:
        parseFloat(obj.totalDiscountSet?.shopMoney?.amount || "0") *
        rate /
        (1 + taxRate),
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

  const { data, error } = await supabase
    .from("skus")
    .upsert(skus, { onConflict: "shop,order_id,sku" });

  if (error) {
    console.error(`❌ Supabase upsert error:`, JSON.stringify(error, null, 2));
    throw new Error(`Failed upsert SKUs: ${error.message}`);
  }

  console.log(`✅ Successfully upserted ${skus.length} SKUs`);
}