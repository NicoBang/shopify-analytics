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
  const env = Deno.env.toObject();
  const authHeader = req.headers.get("Authorization") || "";
  const invokerKey =
    env["FUNCTIONS_INVOKER_KEY"] ||
    Deno.env.get("FUNCTIONS_INVOKER_KEY") ||
    env["API_SECRET_KEY"];

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
  const day = startISO.split("T")[0];
  console.log(`💸 Fetching orders with refunds for ${day} from database`);

  // Get all unique order_ids from database (all orders, not filtered by date)
  // We filter by checking refund dates from Shopify API instead
  const { data: orders, error: ordersError } = await supabase
    .from("skus")
    .select("order_id")
    .eq("shop", shop)
    .limit(1000); // Process in batches to avoid timeouts

  if (ordersError) {
    throw new Error(`Database error: ${ordersError.message}`);
  }

  const uniqueOrderIds = [...new Set(orders.map((o: any) => o.order_id))];
  console.log(`📦 Found ${uniqueOrderIds.length} unique orders to check for refunds`);

  const refundUpdates: RefundUpdate[] = [];
  let processedOrders = 0;

  // Fetch refunds for each order via REST API
  for (const orderId of uniqueOrderIds) {
    processedOrders++;

    if (processedOrders % 50 === 0) {
      console.log(`⏳ Progress: ${processedOrders}/${uniqueOrderIds.length} orders processed`);
    }

    try {
      // Shopify REST API: GET /admin/api/2024-10/orders/{order_id}/refunds.json
      const refundsUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/refunds.json`;
      const refundsRes = await fetch(refundsUrl, {
        headers: {
          "X-Shopify-Access-Token": token,
        },
      });

      if (!refundsRes.ok) {
        console.warn(`⚠️ Failed to fetch refunds for order ${orderId}: ${refundsRes.status}`);
        continue;
      }

      const refundsData = await refundsRes.json();
      const refunds = refundsData.refunds || [];

      if (refunds.length === 0) continue;

      // Parse refund_line_items from each refund
      for (const refund of refunds) {
        const refundDate = refund.created_at;

        // Only process refunds created within the specified date range
        if (refundDate < startISO || refundDate > endISO) {
          continue;
        }

        const refundLineItems = refund.refund_line_items || [];

        for (const item of refundLineItems) {
          const lineItem = item.line_item || {};
          const sku = lineItem.sku;
          const quantity = item.quantity;
          const amount = parseFloat(item.subtotal || "0");
          const currency = lineItem.price_set?.shop_money?.currency_code || "DKK";
          const rate = CURRENCY_RATES[currency] || 1;
          const amountDkk = amount * rate;

          if (!sku) {
            console.warn(`⚠️ Refund line item missing SKU in order ${orderId}`);
            continue;
          }

          const key = `${shop}-${orderId}-${sku}`;
          const existing = refundUpdates.find(
            (r) => r.shop === shop && r.order_id === orderId && r.sku === sku
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
              order_id: orderId,
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
      console.error(`❌ Error fetching refunds for order ${orderId}:`, err.message);
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
      }
    }
  }

  console.log(`✅ Updated ${updatedCount} SKUs with refund data`);
  return updatedCount;
}
