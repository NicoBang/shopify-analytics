// Shopify Refund Enrichment - Updates refund data for existing orders
// Fetches orders from database (created in date range) and enriches with refund data from Shopify REST API
// This is a "data enrichment" function, not a full sync - requires orders to already exist in DB

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPIFY_API_VERSION = "2024-10";
const BATCH_SIZE = 100; // Process orders in batches
const EDGE_FUNCTION_TIMEOUT_MS = 300000; // 5 minutes
const MAX_ORDERS_PER_RUN = 100; // Limit orders per function invocation to avoid timeout

// Currency conversion rates (DKK base)
const CURRENCY_RATES: Record<string, number> = {
  DKK: 1.0,
  EUR: 7.46,
  CHF: 6.84,
};

interface RefundEnrichmentRequest {
  shop: string;
  startDate: string;
  endDate: string;
}

serve(async (req) => {
  try {
    const { shop, startDate, endDate }: RefundEnrichmentRequest = await req.json();

    if (!shop || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop, startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });

    // Get Shopify access token
    const shopifyToken = getShopifyToken(shop);
    if (!shopifyToken) {
      return new Response(
        JSON.stringify({ error: `No access token found for shop: ${shop}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();

    console.log(`🔄 Refund Enrichment for ${shop}: ${startDate} to ${endDate}`);
    console.log(`   Strategy: Fetch order IDs from DB → Get refund data from Shopify → Update DB`);

    // Step 1: Get all order IDs from database for this shop and date range
    console.log(`\n📊 Step 1: Fetching order IDs from database...`);

    // Convert dates to ISO format for TIMESTAMPTZ comparison
    const startISO = new Date(startDate).toISOString();
    const endDateObj = new Date(endDate);
    endDateObj.setHours(23, 59, 59, 999);
    const endISO = endDateObj.toISOString();

    const { data: existingOrders, error: fetchError } = await supabase
      .from("orders")
      .select("order_id, shop")
      .eq("shop", shop)
      .gte("created_at", startISO)
      .lte("created_at", endISO);

    if (fetchError) {
      throw new Error(`Failed to fetch orders: ${fetchError.message}`);
    }

    if (!existingOrders || existingOrders.length === 0) {
      console.log(`⚠️ No orders found in database for ${shop} between ${startDate} and ${endDate}`);
      console.log(`   Run bulk-sync-orders first to sync orders before enriching with refund data!`);

      return new Response(
        JSON.stringify({
          success: true,
          ordersProcessed: 0,
          skusProcessed: 0,
          message: "No orders found in database. Run bulk-sync-orders first."
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Found ${existingOrders.length} orders in database`);

    // Limit orders to prevent timeout
    const limitedOrders = existingOrders.slice(0, MAX_ORDERS_PER_RUN);
    const wasLimited = existingOrders.length > MAX_ORDERS_PER_RUN;

    if (wasLimited) {
      console.log(`⚠️ Too many orders (${existingOrders.length}) - limiting to ${MAX_ORDERS_PER_RUN} per run`);
      console.log(`   ${existingOrders.length - MAX_ORDERS_PER_RUN} orders will need additional runs`);
      console.log(`   Recommendation: Use smaller date ranges (hourly instead of daily)`);
    }

    // Step 2: Process orders in batches and fetch refund data
    console.log(`\n📦 Step 2: Fetching refund data from Shopify...`);
    console.log(`   Processing ${limitedOrders.length} orders`);

    // Warn if order count is very high
    if (limitedOrders.length > 50) {
      console.log(`   ⚠️ Large batch: ${limitedOrders.length} orders - this may take several minutes`);
    }

    const ordersBatch: any[] = [];
    const skusBatch: any[] = [];
    let ordersWithRefunds = 0;
    let totalRefunds = 0;
    let ordersProcessed = 0;

    for (let i = 0; i < limitedOrders.length; i++) {
      const { order_id } = limitedOrders[i];

      // Check timeout
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > EDGE_FUNCTION_TIMEOUT_MS) {
        console.log(`\n⏱️ TIMEOUT WARNING: Processed ${ordersProcessed}/${limitedOrders.length} orders before timeout`);
        console.log(`   ${limitedOrders.length - ordersProcessed} orders remaining - reduce date range or run again`);
        break;
      }

      // Fetch refunds for this order from Shopify REST API
      try {
        const refundsUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order_id}/refunds.json`;
        const refundsResponse = await fetch(refundsUrl, {
          headers: { "X-Shopify-Access-Token": shopifyToken }
        });

        if (!refundsResponse.ok) {
          console.log(`   ⚠️ Failed to fetch refunds for order ${order_id}: ${refundsResponse.status}`);
          ordersProcessed++;
          continue;
        }

        const refundsData = await refundsResponse.json();
        const refunds = refundsData.refunds || [];

        if (refunds.length === 0) {
          ordersProcessed++;
          continue; // Skip orders without refunds
        }

        ordersWithRefunds++;
        totalRefunds += refunds.length;

        // Fetch full order data to get line items
        const orderUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order_id}.json`;
        const orderResponse = await fetch(orderUrl, {
          headers: { "X-Shopify-Access-Token": shopifyToken }
        });

        if (!orderResponse.ok) {
          console.log(`   ⚠️ Failed to fetch order ${order_id}: ${orderResponse.status}`);
          ordersProcessed++;
          continue;
        }

        const orderData = await orderResponse.json();
        const order = orderData.order;

        // Parse order with refund data - wrap in try/catch for malformed data
        try {
          const parsedOrder = parseRESTOrder(order, shop, refunds);
          ordersBatch.push(parsedOrder);

          // Parse SKUs with refund data
          for (const lineItem of order.line_items || []) {
            if (!lineItem.sku) continue;

            const skuData = parseRESTLineItem(lineItem, order, shop, refunds);
            if (skuData) {
              skusBatch.push(skuData);
            }
          }
        } catch (parseError: any) {
          console.log(`   ⚠️ Parse error for order ${order_id}: ${parseError.message}`);
          console.log(`   Order data sample: ${JSON.stringify(order).substring(0, 200)}...`);
          ordersProcessed++;
          continue;
        }

        ordersProcessed++;

        if (ordersProcessed % 10 === 0) {
          console.log(`   Processed ${ordersProcessed}/${limitedOrders.length} orders (${ordersWithRefunds} with refunds)`);
        }

      } catch (error: any) {
        console.log(`   ⚠️ Error processing order ${order_id}: ${error.message}`);
        if (error.stack) {
          console.log(`   Stack: ${error.stack.substring(0, 200)}`);
        }
        ordersProcessed++;
        continue;
      }

      // Small delay to avoid rate limiting
      if (i % 50 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n✅ Found ${ordersWithRefunds} orders with refunds (${totalRefunds} total refunds)`);

    // Step 3: Update database
    console.log(`\n📝 Step 3: Updating database...`);

    let ordersUpdated = 0;
    let skusUpdated = 0;

    if (ordersBatch.length > 0) {
      for (let i = 0; i < ordersBatch.length; i += BATCH_SIZE) {
        const batch = ordersBatch.slice(i, i + BATCH_SIZE);
        await upsertOrders(supabase, batch);
        ordersUpdated += batch.length;
        console.log(`   ✅ Updated ${Math.min(i + BATCH_SIZE, ordersBatch.length)}/${ordersBatch.length} orders`);
      }
    }

    if (skusBatch.length > 0) {
      for (let i = 0; i < skusBatch.length; i += BATCH_SIZE) {
        const batch = skusBatch.slice(i, i + BATCH_SIZE);
        await upsertSkus(supabase, batch);
        skusUpdated += batch.length;
        console.log(`   ✅ Updated ${Math.min(i + BATCH_SIZE, skusBatch.length)}/${skusBatch.length} SKUs`);
      }
    }

    const totalDuration = Date.now() - startTime;
    const wasTimeout = ordersProcessed < limitedOrders.length;

    console.log(`\n🎉 Refund enrichment ${wasTimeout ? 'PARTIAL (timeout)' : wasLimited ? 'PARTIAL (limit)' : 'complete'} in ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`   Orders scanned: ${ordersProcessed}/${limitedOrders.length}${wasLimited ? ` (${existingOrders.length - MAX_ORDERS_PER_RUN} skipped)` : ''}`);
    console.log(`   Orders with refunds: ${ordersWithRefunds}`);
    console.log(`   Orders updated: ${ordersUpdated}`);
    console.log(`   SKUs updated: ${skusUpdated}`);

    if (wasTimeout) {
      console.log(`\n⚠️ TIMEOUT: Only processed ${ordersProcessed}/${limitedOrders.length} orders`);
      console.log(`   Recommendation: Split date range into smaller chunks (hourly instead of daily)`);
    } else if (wasLimited) {
      console.log(`\n⚠️ LIMIT: Only processed ${MAX_ORDERS_PER_RUN} of ${existingOrders.length} total orders`);
      console.log(`   Recommendation: Use smaller date ranges (1-2 hour chunks) or run multiple times`);
    }

    return new Response(
      JSON.stringify({
        success: !wasTimeout && !wasLimited,
        partial: wasTimeout || wasLimited,
        ordersProcessed: ordersUpdated,
        skusProcessed: skusUpdated,
        ordersScanned: ordersProcessed,
        totalOrders: existingOrders.length,
        limitedOrders: limitedOrders.length,
        ordersWithRefunds,
        totalRefunds,
        timedOut: wasTimeout,
        limited: wasLimited,
        durationSec: Math.round(totalDuration / 1000)
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Error:", error.message);
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

function parseRESTOrder(order: any, shop: string, refunds: any[]): any {
  const currency = order.currency || "DKK";
  const rate = CURRENCY_RATES[currency] || 1.0;

  let refundedAmount = 0;
  let refundedQty = 0;
  let refundDate = null;

  if (refunds && refunds.length > 0) {
    for (const refund of refunds) {
      const refundLineItems = refund.refund_line_items || [];

      for (const refundLineItem of refundLineItems) {
        const qty = refundLineItem.quantity || 0;
        const subtotal = parseFloat(refundLineItem.subtotal || "0");

        refundedQty += qty;
        refundedAmount += subtotal * rate;
      }

      const refundCreatedAt = refund.created_at;
      if (refundCreatedAt && (!refundDate || new Date(refundCreatedAt) > new Date(refundDate))) {
        refundDate = refundCreatedAt;
      }
    }
  }

  return {
    shop,
    order_id: String(order.id),
    refunded_amount: refundedAmount,
    refunded_qty: refundedQty,
    refund_date: refundDate,
  };
}

function parseRESTLineItem(lineItem: any, order: any, shop: string, refunds: any[]): any {
  const currency = order.currency || "DKK";
  const rate = CURRENCY_RATES[currency] || 1.0;

  // Find refund data for this SKU
  let refundedQty = 0;
  let refundedAmount = 0;
  let refundDate = null;

  if (refunds) {
    for (const refund of refunds) {
      const refundLineItems = refund.refund_line_items || [];

      for (const refundLineItem of refundLineItems) {
        const refundedLineItemId = refundLineItem.line_item_id;
        const refundedSku = refundLineItem.line_item?.sku;

        const idMatch = refundedLineItemId == lineItem.id;
        const skuMatch = refundedSku && lineItem.sku && refundedSku === lineItem.sku;

        if (idMatch || skuMatch) {
          const qty = refundLineItem.quantity || 0;
          const subtotal = parseFloat(refundLineItem.subtotal || "0");

          refundedQty += qty;
          refundedAmount += subtotal * rate;

          const refundCreatedAt = refund.created_at;
          if (refundCreatedAt && (!refundDate || new Date(refundCreatedAt) > new Date(refundDate))) {
            refundDate = refundCreatedAt;
          }
        }
      }
    }
  }

  return {
    shop,
    order_id: String(order.id),
    sku: lineItem.sku,
    refunded_qty: refundedQty,
    refunded_amount_dkk: refundedAmount,
    refund_date: refundDate,
  };
}

async function upsertOrders(supabase: any, orders: any[]): Promise<void> {
  // Update refund fields only using Postgres UPDATE
  for (const order of orders) {
    const { error } = await supabase
      .from("orders")
      .update({
        refunded_amount: order.refunded_amount,
        refunded_qty: order.refunded_qty,
        refund_date: order.refund_date
      })
      .eq("shop", order.shop)
      .eq("order_id", order.order_id);

    if (error) {
      throw new Error(`Failed to update order ${order.order_id}: ${error.message}`);
    }
  }
}

async function upsertSkus(supabase: any, skus: any[]): Promise<void> {
  // Update refund fields only using Postgres UPDATE
  for (const sku of skus) {
    const { error } = await supabase
      .from("skus")
      .update({
        refunded_qty: sku.refunded_qty,
        refunded_amount_dkk: sku.refunded_amount_dkk,
        refund_date: sku.refund_date
      })
      .eq("shop", sku.shop)
      .eq("order_id", sku.order_id)
      .eq("sku", sku.sku);

    if (error) {
      throw new Error(`Failed to update SKU ${sku.sku}: ${error.message}`);
    }
  }
}
