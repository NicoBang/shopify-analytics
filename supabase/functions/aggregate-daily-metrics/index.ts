import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Aggregate Daily Metrics
 *
 * Purpose: Pre-aggregate daily shop metrics for instant dashboard performance
 * Schedule: Daily at 02:00 AM (via pg_cron)
 *
 * Process:
 * 1. Aggregate yesterday's data per shop from skus table
 * 2. Calculate revenue, quantities, returns, cancellations
 * 3. Upsert into daily_shop_metrics table
 *
 * Result: Dashboard queries <2 seconds (vs. 57 seconds before)
 */

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    // Parse input (optional date override for backfill)
    const { targetDate } = await req.json().catch(() => ({}));

    // Default to yesterday (since cron runs at 02:00 for previous day's data)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const aggregateDate = targetDate ? new Date(targetDate) : yesterday;
    const dateStr = aggregateDate.toISOString().split('T')[0];

    // CRITICAL FIX: Dansk tid er UTC+2, så 16. oktober dansk tid starter kl 22:00 UTC den 15. oktober
    // For at få data for 16. oktober dansk tid: 2024-10-15T22:00:00Z til 2024-10-16T21:59:59Z
    const danishDateStart = new Date(dateStr);
    danishDateStart.setUTCDate(danishDateStart.getUTCDate() - 1); // Start dagen før
    danishDateStart.setUTCHours(22, 0, 0, 0); // 00:00 dansk tid = 22:00 UTC dagen før

    const danishDateEnd = new Date(dateStr);
    danishDateEnd.setUTCHours(21, 59, 59, 999); // 23:59:59 dansk tid = 21:59:59 UTC samme dag

    console.log(`📊 Aggregating metrics for Danish date: ${dateStr}`);
    console.log(`   UTC range: ${danishDateStart.toISOString()} to ${danishDateEnd.toISOString()}`);

    // Get all shops
    const shops = [
      'pompdelux-da.myshopify.com',
      'pompdelux-de.myshopify.com',
      'pompdelux-nl.myshopify.com',
      'pompdelux-int.myshopify.com',
      'pompdelux-chf.myshopify.com'
    ];

    const results = [];

    for (const shop of shops) {
      console.log(`  Processing ${shop}...`);

      // STEP 1: Aggregate metrics for today's date
      await aggregateShopDate(supabase, shop, dateStr);
      console.log(`  ✅ ${shop} metrics aggregated for ${dateStr}`);

      // STEP 2: Find SKUs that were UPDATED today (but created on different dates)
      // These indicate changes to historical orders that need re-aggregation
      const datesToReaggregate = new Set<string>();
      const batchSize = 1000;
      let updateOffset = 0;
      let hasMoreUpdates = true;

      while (hasMoreUpdates) {
        const { data: updateBatch, error: updateBatchError } = await supabase
          .from('skus')
          .select('created_at_original')
          .eq('shop', shop)
          .gte('updated_at', danishDateStart.toISOString())
          .lte('updated_at', danishDateEnd.toISOString())
          .order('updated_at', { ascending: false })
          .range(updateOffset, updateOffset + batchSize - 1);

        if (updateBatchError) {
          console.error(`  ❌ Error fetching updated SKU batch at offset ${updateOffset}:`, updateBatchError);
          break;
        }

        if (updateBatch && updateBatch.length > 0) {
          // Track dates that need re-aggregation
          updateBatch.forEach(sku => {
            const createdDate = new Date(sku.created_at_original).toISOString().split('T')[0];
            if (createdDate !== dateStr) {
              // SKU was created on a different date but updated today - need to re-aggregate that date
              datesToReaggregate.add(createdDate);
            }
          });

          hasMoreUpdates = updateBatch.length === batchSize;
          updateOffset += batchSize;
        } else {
          hasMoreUpdates = false;
        }
      }

      // STEP 3: Re-aggregate affected historical dates
      if (datesToReaggregate.size > 0) {
        console.log(`    📅 Found ${datesToReaggregate.size} dates that need re-aggregation due to SKU updates: ${Array.from(datesToReaggregate).join(', ')}`);

        for (const affectedDate of datesToReaggregate) {
          console.log(`    🔄 Re-aggregating ${shop} for ${affectedDate} (SKU updates detected)...`);
          await aggregateShopDate(supabase, shop, affectedDate);
          console.log(`    ✅ ${shop} re-aggregated for ${affectedDate}`);
        }
      }

      results.push({ shop, date: dateStr });
    }

    console.log(`✅ Aggregation complete for ${dateStr}`);

    return new Response(JSON.stringify({
      success: true,
      date: dateStr,
      shops: results.length,
      metrics: results
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("❌ Aggregation error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

async function upsertMetrics(supabase: any, shop: string, metricDate: string, metrics: any) {
  const { error } = await supabase
    .from('daily_shop_metrics')
    .upsert({
      shop,
      metric_date: metricDate,
      ...metrics,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'shop,metric_date'
    });

  if (error) {
    console.error(`  ❌ Error upserting metrics for ${shop}:`, error);
    throw error;
  }
}

/**
 * Aggregate metrics for a specific shop and date
 * This function is extracted to support both:
 * 1. Regular daily aggregation
 * 2. Re-aggregation when SKUs are updated
 */
async function aggregateShopDate(supabase: any, shop: string, dateStr: string) {
  const batchSize = 1000;

  // Calculate UTC range for Danish date
  const danishDateStart = new Date(dateStr);
  danishDateStart.setUTCDate(danishDateStart.getUTCDate() - 1);
  danishDateStart.setUTCHours(22, 0, 0, 0);

  const danishDateEnd = new Date(dateStr);
  danishDateEnd.setUTCHours(21, 59, 59, 999);

  // Fetch SKUs created on this date
  const skuData = [];
  let skuOffset = 0;
  let hasMoreSkus = true;

  while (hasMoreSkus) {
    const { data: skuBatch, error: skuBatchError } = await supabase
      .from('skus')
      .select('quantity, cancelled_qty, price_dkk, cancelled_amount_dkk, discount_per_unit_dkk, sale_discount_per_unit_dkk, order_id')
      .eq('shop', shop)
      .gte('created_at_original', danishDateStart.toISOString())
      .lte('created_at_original', danishDateEnd.toISOString())
      .order('created_at_original', { ascending: false })
      .range(skuOffset, skuOffset + batchSize - 1);

    if (skuBatchError) {
      console.error(`    ❌ Error fetching SKU batch: ${skuBatchError.message}`);
      break;
    }

    if (skuBatch && skuBatch.length > 0) {
      skuData.push(...skuBatch);
      hasMoreSkus = skuBatch.length === batchSize;
      skuOffset += batchSize;
    } else {
      hasMoreSkus = false;
    }
  }

  // Fetch refunds for this date
  const refundData = [];
  let refundOffset = 0;
  let hasMoreRefunds = true;

  while (hasMoreRefunds) {
    const { data: refundBatch, error: refundBatchError } = await supabase
      .from('skus')
      .select('refunded_qty, refunded_amount_dkk, order_id, cancelled_qty')
      .eq('shop', shop)
      .gt('refunded_qty', 0)
      .not('refund_date', 'is', null)  // ✅ CRITICAL: Only SKUs with refund_date (excludes cancelled-only)
      .gte('refund_date', danishDateStart.toISOString())
      .lte('refund_date', danishDateEnd.toISOString())
      .order('refund_date', { ascending: false })
      .range(refundOffset, refundOffset + batchSize - 1);

    if (refundBatchError) {
      console.error(`    ❌ Error fetching refund batch: ${refundBatchError.message}`);
      break;
    }

    if (refundBatch && refundBatch.length > 0) {
      refundData.push(...refundBatch);
      hasMoreRefunds = refundBatch.length === batchSize;
      refundOffset += batchSize;
    } else {
      hasMoreRefunds = false;
    }
  }

  // If no orders created on this date, check for refunds only
  if (!skuData || skuData.length === 0) {
    let returnQty = 0;
    let returnAmount = 0;
    let returnOrders = new Set();

    if (refundData && refundData.length > 0) {
      refundData.forEach(refund => {
        // ✅ CRITICAL: Refunds query already excludes cancelled-only orders (has refund_date filter)
        // So we can safely count all refunded_qty as returns
        const refundedQty = refund.refunded_qty || 0;
        const refundedAmount = refund.refunded_amount_dkk || 0;

        if (refundedQty > 0) {
          returnQty += refundedQty;
          returnAmount += refundedAmount;
          returnOrders.add(refund.order_id);
        }
      });
    }

    // Check shipping refunds
    const { data: shippingRefundData } = await supabase
      .from('orders')
      .select('shipping_refund_dkk')
      .eq('shop', shop)
      .gt('shipping_refund_dkk', 0)
      .gte('refund_date', danishDateStart.toISOString())
      .lte('refund_date', danishDateEnd.toISOString());

    let shippingRefunds = 0;
    if (shippingRefundData) {
      shippingRefunds = shippingRefundData.reduce((sum, o) => sum + (o.shipping_refund_dkk || 0), 0);
    }

    await upsertMetrics(supabase, shop, dateStr, {
      order_count: 0,
      revenue_gross: 0,
      revenue_net: -returnAmount,
      sku_quantity_gross: 0,
      sku_quantity_net: -returnQty,
      return_quantity: returnQty,
      return_amount: returnAmount,
      return_order_count: returnOrders.size,
      cancelled_quantity: 0,
      cancelled_amount: 0,
      shipping_revenue: 0,
      shipping_discount: 0,
      shipping_refund: Math.round(shippingRefunds * 100) / 100,
      order_discount_total: 0,
      sale_discount_total: 0,
      total_discounts: 0
    });
    return;
  }

  // Calculate metrics
  const uniqueOrders = new Set(skuData.map(s => s.order_id));
  let revenueGross = 0;
  let revenueNet = 0;
  let skuQtyGross = 0;
  let skuQtyNet = 0;
  let returnQty = 0;
  let returnAmount = 0;
  let returnOrders = new Set();
  let cancelledQty = 0;
  let cancelledAmount = 0;
  let orderDiscountTotal = 0;
  let saleDiscountTotal = 0;
  let totalDiscounts = 0;

  skuData.forEach(sku => {
    const qty = sku.quantity || 0;
    const cancelledQtyItem = sku.cancelled_qty || 0;
    const price = sku.price_dkk || 0;
    const cancelledAmountItem = sku.cancelled_amount_dkk || 0;
    const discountPerUnit = sku.discount_per_unit_dkk || 0;
    const saleDiscountPerUnit = sku.sale_discount_per_unit_dkk || 0;

    const totalPrice = price * qty;
    const orderDiscountAmount = discountPerUnit * qty;
    const saleDiscountAmount = saleDiscountPerUnit * qty;

    // CRITICAL: revenue_gross = (price * qty) - cancelled_amount (NO discounts subtracted here!)
    const bruttoRevenue = totalPrice - cancelledAmountItem;

    revenueGross += bruttoRevenue;

    const bruttoQty = qty - cancelledQtyItem;
    skuQtyGross += bruttoQty;

    cancelledQty += cancelledQtyItem;
    cancelledAmount += cancelledAmountItem;

    // Track discounts separately
    orderDiscountTotal += orderDiscountAmount;
    saleDiscountTotal += saleDiscountAmount;
    totalDiscounts += orderDiscountAmount + saleDiscountAmount;
  });

  // Process refunds
  if (refundData && refundData.length > 0) {
    refundData.forEach(refund => {
      // ✅ CRITICAL FIX (2025-10-22): Refunds query already excludes cancelled-only orders
      // (has refund_date filter which is NULL for cancelled orders)
      // So we can safely count all refunded_qty as returns
      const refundedQty = refund.refunded_qty || 0;
      const refundedAmount = refund.refunded_amount_dkk || 0;

      if (refundedQty > 0) {
        returnQty += refundedQty;
        returnAmount += refundedAmount;
        returnOrders.add(refund.order_id);
      }
    });
  }

  revenueNet = revenueGross - returnAmount;
  skuQtyNet = skuQtyGross - returnQty;

  // Get shipping metrics
  const { data: orderData } = await supabase
    .from('orders')
    .select('shipping_price_dkk, shipping_discount_dkk')
    .eq('shop', shop)
    .gte('created_at', danishDateStart.toISOString())
    .lte('created_at', danishDateEnd.toISOString());

  let shippingRevenue = 0;
  let shippingDiscounts = 0;
  if (orderData) {
    shippingRevenue = orderData.reduce((sum, o) => sum + (o.shipping_price_dkk || 0), 0);
    shippingDiscounts = orderData.reduce((sum, o) => sum + (o.shipping_discount_dkk || 0), 0);
  }

  // Get shipping refunds
  const { data: shippingRefundData } = await supabase
    .from('orders')
    .select('shipping_refund_dkk')
    .eq('shop', shop)
    .gt('shipping_refund_dkk', 0)
    .gte('refund_date', danishDateStart.toISOString())
    .lte('refund_date', danishDateEnd.toISOString());

  let shippingRefunds = 0;
  if (shippingRefundData) {
    shippingRefunds = shippingRefundData.reduce((sum, o) => sum + (o.shipping_refund_dkk || 0), 0);
  }

  // Upsert metrics
  await upsertMetrics(supabase, shop, dateStr, {
    order_count: uniqueOrders.size,
    revenue_gross: Math.round(revenueGross * 100) / 100,
    revenue_net: Math.round(revenueNet * 100) / 100,
    sku_quantity_gross: skuQtyGross,
    sku_quantity_net: skuQtyNet,
    return_quantity: returnQty,
    return_amount: Math.round(returnAmount * 100) / 100,
    return_order_count: returnOrders.size,
    cancelled_quantity: cancelledQty,
    cancelled_amount: Math.round(cancelledAmount * 100) / 100,
    shipping_revenue: Math.round(shippingRevenue * 100) / 100,
    shipping_discount: Math.round(shippingDiscounts * 100) / 100,
    shipping_refund: Math.round(shippingRefunds * 100) / 100,
    order_discount_total: Math.round(orderDiscountTotal * 100) / 100,
    sale_discount_total: Math.round(saleDiscountTotal * 100) / 100,
    total_discounts: Math.round(totalDiscounts * 100) / 100
  });
}
