import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
}

interface RefundUpdate {
  shop: string;
  order_id: string;
  sku: string;
  refunded_qty: number;
  refund_date: string;
  cancelled_amount_dkk: number;
}

serve(async (req: Request): Promise<Response> => {
  try {
    console.log("🚀 bulk-sync-refunds function invoked");

    const env = Deno.env.toObject();
    const authHeader = req.headers.get("Authorization") || "";
    const invokerKey =
      env["FUNCTIONS_INVOKER_KEY"] ||
      Deno.env.get("FUNCTIONS_INVOKER_KEY") ||
      env["API_SECRET_KEY"];

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

    console.log("✅ Authorization successful");

    const body = await req.json().catch(() => null);
    if (!body) {
      console.error("❌ Invalid or missing JSON body");
      return new Response(
        JSON.stringify({ error: "Invalid or missing JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { shop, startDate, endDate }: BulkSyncRequest = body;
    console.log(`📋 Request params: shop=${shop}, startDate=${startDate}, endDate=${endDate}`);

    if (!shop || !startDate || !endDate) {
      console.error("❌ Missing required fields");
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, startDate, endDate",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("🔗 Creating Supabase client");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log("🔑 Getting Shopify token");
    const token = getShopifyToken(shop);
    if (!token) {
      const error = `No Shopify token found for shop ${shop}`;
      console.error(`❌ ${error}`);
      throw new Error(error);
    }

    console.log(`🚀 Starting refund sync for ${shop} from ${startDate} to ${endDate}`);
    const days = generateDailyIntervals(startDate, endDate);
    console.log(`📅 Processing ${days.length} days`);

    const results: any[] = [];

    for (const day of days) {
      console.log(`💸 Syncing refunds for ${day.date}`);
      const res = await syncRefundsForDay(shop, token, supabase, day.startISO, day.endISO);
      results.push(res);
    }

    const response = { success: true, results };
    console.log(`🎉 Final response:`, JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Uncaught error:", err);
    console.error("Stack trace:", err.stack);
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
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

function generateDailyIntervals(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const days: Array<{ date: string; startISO: string; endISO: string }> = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const startISO = `${dateStr}T00:00:00Z`;
    const endISO = `${dateStr}T23:59:59Z`;
    days.push({ date: dateStr, startISO, endISO });
  }

  return days;
}

async function syncRefundsForDay(
  shop: string,
  token: string,
  supabase: any,
  startISO: string,
  endISO: string
) {
  try {
    const day = startISO.split("T")[0];
    console.log(`💸 Fetching orders with refunds for ${day} from database`);

    // Get all unique order_ids from database (all orders, not filtered by date)
    // We filter by checking refund dates from Shopify API instead
    console.log(`🔍 Querying Supabase for orders from shop: ${shop}`);
    const { data: orders, error: ordersError } = await supabase
      .from("skus")
      .select("order_id")
      .eq("shop", shop)
      .limit(1000); // Process in batches to avoid timeouts

    if (ordersError) {
      console.error(`❌ Database error:`, ordersError);
      throw new Error(`Database error: ${ordersError.message}`);
    }

    console.log(`📦 Supabase returned ${orders?.length || 0} order records`);

    const uniqueOrderIds = [...new Set(orders.map((o: any) => String(o.order_id)))];
    console.log(`📦 Found ${uniqueOrderIds.length} unique orders to check for refunds`);

    if (uniqueOrderIds.length === 0) {
      console.log(`⚠️ No orders found in database for shop ${shop}`);
      return {
        day,
        status: "success",
        ordersFetched: 0,
        refundsProcessed: 0,
        skusUpdated: 0,
      };
    }

  const refundUpdates: RefundUpdate[] = [];
  let processedOrders = 0;

  // Fetch refunds for each order via REST API
  for (const orderId of uniqueOrderIds) {
    const orderIdStr = String(orderId);
    processedOrders++;

    // Log detailed response for first 2 orders
    const shouldLogDetail = processedOrders <= 2;

    if (processedOrders % 50 === 0) {
      console.log(`⏳ Progress: ${processedOrders}/${uniqueOrderIds.length} orders processed`);
    }

    try {
      if (shouldLogDetail) {
        console.log(`🔗 [DETAILED] Fetching refunds for order ${orderIdStr}`);
      }

      // Shopify REST API: GET /admin/api/2024-10/orders/{order_id}/refunds.json
      // Request all fields including refund_line_items and transactions
      const refundsUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderIdStr}/refunds.json?fields=id,order_id,created_at,refund_line_items,transactions`;

      if (shouldLogDetail) {
        console.log(`🌐 [DETAILED] Endpoint: ${refundsUrl}`);
      }

      const refundsRes = await fetch(refundsUrl, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      });

      if (!refundsRes.ok) {
        console.warn(`⚠️ Failed to fetch refunds for order ${orderIdStr}: ${refundsRes.status}`);
        continue;
      }

      const text = await refundsRes.text();

      if (shouldLogDetail) {
        console.log(`📨 [DETAILED] Shopify raw response for order ${orderIdStr}:`, text);
      }

      let refundsData;
      try {
        refundsData = JSON.parse(text);
      } catch (parseErr) {
        console.error(`❌ Failed to parse JSON for order ${orderIdStr}:`, parseErr);
        refundsData = null;
      }

      if (shouldLogDetail) {
        console.log(`🧾 [DETAILED] Refund data for order ${orderIdStr}:`, JSON.stringify(refundsData, null, 2));
      }

      const refunds = refundsData?.refunds || [];

      if (shouldLogDetail) {
        console.log(`📊 [DETAILED] Found ${refunds.length} refunds for order ${orderIdStr}`);
        if (refunds.length > 0) {
          console.log(`🔍 [DETAILED] First refund structure:`, JSON.stringify(refunds[0], null, 2));
          console.log(`🔍 [DETAILED] First refund keys:`, Object.keys(refunds[0]));
          console.log(`🔍 [DETAILED] First refund has refund_line_items?`, !!refunds[0].refund_line_items);
          if (refunds[0].refund_line_items) {
            console.log(`📦 [DETAILED] refund_line_items count:`, refunds[0].refund_line_items.length);
            if (refunds[0].refund_line_items.length > 0) {
              console.log(`📦 [DETAILED] First refund_line_item:`, JSON.stringify(refunds[0].refund_line_items[0], null, 2));
            }
          }
        }
      }

      if (refunds.length === 0) continue;

      // Parse refund_line_items from each refund
      for (const refund of refunds) {
        const refundDate = refund.created_at;

        // Only process refunds created within the specified date range
        if (refundDate < startISO || refundDate > endISO) {
          continue;
        }

        const refundLineItems = refund.refund_line_items || [];

        if (shouldLogDetail && processedOrders <= 2) {
          console.log(`📦 [DETAILED] Found ${refundLineItems.length} refund_line_items for refund ${refund.id}`);
        }

        for (const item of refundLineItems) {
          const lineItem = item.line_item || {};
          const sku = lineItem.sku;
          const quantity = item.quantity;
          const amount = parseFloat(item.subtotal || "0");
          const currency = lineItem.price_set?.shop_money?.currency_code || "DKK";
          const rate = CURRENCY_RATES[currency] || 1;
          const amountDkk = amount * rate;

          if (!sku) {
            console.warn(`⚠️ Refund line item missing SKU in order ${orderIdStr}`);
            continue;
          }

          if (shouldLogDetail && processedOrders <= 2) {
            console.log(`💸 [DETAILED] Processing refund for SKU ${sku}: qty=${quantity}, amount=${amountDkk.toFixed(2)} DKK, date=${refundDate}`);
          }

          const key = `${shop}-${orderIdStr}-${sku}`;
          const existing = refundUpdates.find(
            (r) => r.shop === shop && r.order_id === orderIdStr && r.sku === sku
          );

          if (existing) {
            existing.refunded_qty += quantity;
            existing.cancelled_amount_dkk += amountDkk;
            if (new Date(refundDate) > new Date(existing.refund_date)) {
              existing.refund_date = refundDate;
            }
          } else {
            refundUpdates.push({
              shop,
              order_id: orderIdStr,
              sku,
              refunded_qty: quantity,
              refund_date: refundDate,
              cancelled_amount_dkk: amountDkk,
            });
          }
        }
      }

      // Rate limiting: 2 requests/second for Shopify API
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err: any) {
      console.error(`❌ Error fetching refunds for order ${orderIdStr}:`, err.message);
    }
  }

  console.log(`💸 Found ${refundUpdates.length} refund line items`);
  console.log(`📊 Processing ${processedOrders} orders total`);

  // Update database
  const updatedCount = await updateRefundsInDatabase(supabase, refundUpdates);

  const result = {
    day,
    status: "success",
    ordersFetched: processedOrders,
    refundsProcessed: refundUpdates.length,
    skusUpdated: updatedCount,
  };

  console.log(`✅ Day ${day} complete:`, JSON.stringify(result));
  return result;
  } catch (err: any) {
    console.error(`❌ Error in syncRefundsForDay:`, err);
    console.error("Stack trace:", err.stack);
    throw err;
  }
}

async function updateRefundsInDatabase(
  supabase: any,
  refunds: RefundUpdate[]
): Promise<number> {
  let updatedCount = 0;

  // Batch updates in chunks
  const chunks: RefundUpdate[][] = [];
  for (let i = 0; i < refunds.length; i += BATCH_SIZE) {
    chunks.push(refunds.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    for (const refund of chunk) {
      // Log first 2 updates in detail
      const shouldLogDetail = updatedCount < 2;

      if (shouldLogDetail) {
        console.log(`💸 [DETAILED] Updating SKU ${refund.sku} with refunded_qty=${refund.refunded_qty}, refund_date=${refund.refund_date}, cancelled_amount_dkk=${refund.cancelled_amount_dkk.toFixed(2)}`);
      }

      const { error } = await supabase
        .from("skus")
        .update({
          refunded_qty: refund.refunded_qty,
          refund_date: refund.refund_date,
          cancelled_amount_dkk: refund.cancelled_amount_dkk,
        })
        .match({
          shop: refund.shop,
          order_id: refund.order_id,
          sku: refund.sku,
        });

      if (error) {
        console.error(`❌ Error updating SKU ${refund.sku}:`, error);
      } else {
        updatedCount++;
        if (shouldLogDetail) {
          console.log(`✅ [DETAILED] Successfully updated SKU ${refund.sku}`);
        }
      }
    }
  }

  console.log(`✅ Updated ${updatedCount} SKUs with refund data`);
  return updatedCount;
}
