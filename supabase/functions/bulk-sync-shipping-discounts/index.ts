import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// === CONFIG ==============================================================
const SHOPIFY_API_VERSION = "2024-10";
const CURRENCY_RATES = { DKK: 1.0, EUR: 7.46, CHF: 6.84 };

// === SUPABASE SETUP ======================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// === TOKEN MAP ===========================================================
function getShopifyToken(shop: string) {
  const map: Record<string, string | null> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA"),
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE"),
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL"),
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT"),
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF"),
  };
  return map[shop] || null;
}

// === HELPERS =============================================================
async function safeFetch(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    console.warn(`⚠️ Rate limited — retrying in ${retryAfter}s (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return safeFetch(url, options, attempt + 1);
  }
  return res;
}

// === FETCH ORDERS WITH SHIPPING ==========================================
async function fetchOrdersWithShipping(supabase, shop: string, startDate: string, endDate: string) {
  const startISO = new Date(startDate + "T00:00:00Z").toISOString();
  const endISO = new Date(endDate + "T23:59:59Z").toISOString();

  let allOrders: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from("orders")
      .select("order_id, shop, shipping, tax_rate")
      .eq("shop", shop)
      .gte("shipping", 0) // Include ALL orders (both paid shipping AND free shipping)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    allOrders = allOrders.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
    console.log(`📄 Loaded ${allOrders.length} orders...`);
  }

  return allOrders;
}

// === FETCH SHIPPING DISCOUNT FROM SHOPIFY ================================
async function fetchShippingDiscount(shop: string, token: string, orderId: string) {
  const query = `{
    order(id: "gid://shopify/Order/${orderId}") {
      id
      shippingLines(first: 5) {
        edges {
          node {
            originalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountedPriceSet {
              shopMoney {
                amount
                currencyCode
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
    }
  }`;

  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    console.warn(`⚠️ Failed to fetch shipping for order ${orderId}: ${res.status}`);
    return null;
  }

  const json = await res.json();
  const order = json.data?.order;
  if (!order || !order.shippingLines?.edges?.length) {
    return null;
  }

  // Calculate total shipping discount
  let totalDiscount = 0;
  let currency = "DKK";

  for (const edge of order.shippingLines.edges) {
    const node = edge.node;
    const originalPrice = parseFloat(node.originalPriceSet?.shopMoney?.amount || "0");
    const discountedPrice = parseFloat(node.discountedPriceSet?.shopMoney?.amount || "0");
    currency = node.originalPriceSet?.shopMoney?.currencyCode || "DKK";

    // Discount = original - discounted (INCL VAT)
    const discountInclVat = originalPrice - discountedPrice;
    totalDiscount += discountInclVat;
  }

  return {
    discountInclVat: totalDiscount,
    currency,
  };
}

// === MAIN FUNCTION =======================================================
serve(async (req) => {
  try {
    const { shop, startDate, endDate } = await req.json();

    if (!shop || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "Missing shop/startDate/endDate" }), { status: 400 });
    }

    const token = getShopifyToken(shop);
    if (!token) {
      return new Response(JSON.stringify({ error: `No Shopify token for ${shop}` }), { status: 400 });
    }

    console.log(`🚢 Starting shipping discount sync for ${shop} (${startDate} → ${endDate})`);

    // Fetch orders with shipping > 0
    const orders = await fetchOrdersWithShipping(supabase, shop, startDate, endDate);
    console.log(`📦 Found ${orders.length} orders with shipping`);

    if (orders.length === 0) {
      return new Response(JSON.stringify({ success: true, ordersProcessed: 0 }), { status: 200 });
    }

    let processed = 0;
    const updates: any[] = [];

    for (const order of orders) {
      const orderId = String(order.order_id).replace(/\D/g, "");
      const shippingData = await fetchShippingDiscount(shop, token, orderId);

      if (shippingData) {
        const rate = CURRENCY_RATES[shippingData.currency] || 1;
        const discountInclVatDkk = shippingData.discountInclVat * rate;

        // Convert to EX VAT using tax_rate from database
        const taxRate = order.tax_rate || 0.25;
        const discountExVatDkk = discountInclVatDkk / (1 + taxRate);

        updates.push({
          shop: order.shop,
          order_id: order.order_id,
          shipping_discount_dkk: discountExVatDkk,
        });

        if (discountExVatDkk > 0) {
          console.log(
            `🎁 Order ${orderId}: Shipping discount ${discountExVatDkk.toFixed(2)} DKK (${discountInclVatDkk.toFixed(
              2
            )} INCL VAT)`
          );
        }
      }

      processed++;
      if (processed % 50 === 0) {
        console.log(`⏳ Processed ${processed}/${orders.length} orders`);
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }

    // Update database
    let updated = 0;
    for (const update of updates) {
      const { error } = await supabase
        .from("orders")
        .update({ shipping_discount_dkk: update.shipping_discount_dkk })
        .eq("shop", update.shop)
        .eq("order_id", update.order_id);

      if (error) {
        console.error(`❌ Failed to update order ${update.order_id}: ${error.message}`);
      } else {
        updated++;
      }
    }

    console.log(`✅ Shipping discount sync complete: ${updated}/${updates.length} orders updated`);

    return new Response(
      JSON.stringify({
        success: true,
        ordersProcessed: processed,
        ordersUpdated: updated,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("❌ Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
