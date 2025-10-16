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

      // Aggregate from skus table (orders created on this Danish calendar date)
      const { data: skuData, error: skuError } = await supabase
        .from('skus')
        .select('quantity, cancelled_qty, price_dkk, cancelled_amount_dkk, discount_per_unit_dkk, sale_discount_per_unit_dkk, order_id')
        .eq('shop', shop)
        .gte('created_at_original', danishDateStart.toISOString())
        .lte('created_at_original', danishDateEnd.toISOString());

      // CRITICAL: Fetch refunds separately based on refund_date (not created_at_original)
      const { data: refundData, error: refundError } = await supabase
        .from('skus')
        .select('refunded_qty, refunded_amount_dkk, order_id')
        .eq('shop', shop)
        .gt('refunded_qty', 0)
        .gte('refund_date', danishDateStart.toISOString())
        .lte('refund_date', danishDateEnd.toISOString());

      if (skuError) {
        console.error(`  ❌ Error fetching SKUs for ${shop}:`, skuError);
        continue;
      }

      if (refundError) {
        console.error(`  ❌ Error fetching refunds for ${shop}:`, refundError);
        continue;
      }

      if (!skuData || skuData.length === 0) {
        console.log(`  ⚠️ No order data for ${shop} on ${dateStr}`);
        // Still check for refunds on this date (refund of older orders)
        let returnQty = 0;
        let returnAmount = 0;
        let returnOrders = new Set();

        if (refundData && refundData.length > 0) {
          refundData.forEach(refund => {
            returnQty += refund.refunded_qty || 0;
            returnAmount += refund.refunded_amount_dkk || 0;
            returnOrders.add(refund.order_id);
          });
          console.log(`  📦 Found ${returnQty} refunds for ${shop} on ${dateStr} (${returnOrders.size} orders)`);
        }

        // Also check for shipping refunds on this date
        const { data: shippingRefundData, error: shippingRefundError } = await supabase
          .from('orders')
          .select('shipping_refund_dkk')
          .eq('shop', shop)
          .gt('shipping_refund_dkk', 0)
          .gte('refund_date', danishDateStart.toISOString())
          .lte('refund_date', danishDateEnd.toISOString());

        let shippingRefunds = 0;
        if (!shippingRefundError && shippingRefundData) {
          shippingRefunds = shippingRefundData.reduce((sum, o) => sum + (o.shipping_refund_dkk || 0), 0);
          if (shippingRefunds > 0) {
            console.log(`  📦 Found ${shippingRefunds.toFixed(2)} DKK shipping refunds for ${shop} on ${dateStr}`);
          }
        }

        // Insert zero metrics except refunds
        await upsertMetrics(supabase, shop, dateStr, {
          order_count: 0,
          revenue_gross: 0,
          revenue_net: -returnAmount, // Refunds reduce net revenue
          sku_quantity_gross: 0,
          sku_quantity_net: -returnQty, // Refunds reduce net quantity
          return_quantity: returnQty,
          return_amount: returnAmount,
          return_order_count: returnOrders.size,
          cancelled_quantity: 0,
          cancelled_amount: 0,
          shipping_revenue: 0,
          shipping_discount: 0,
          shipping_refund: Math.round(shippingRefunds * 100) / 100,
          total_discounts: 0
        });
        continue;
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
      let totalDiscounts = 0;

      skuData.forEach(sku => {
        const qty = sku.quantity || 0;
        const cancelledQtyItem = sku.cancelled_qty || 0;
        const price = sku.price_dkk || 0;
        const cancelledAmountItem = sku.cancelled_amount_dkk || 0;
        const discountPerUnit = sku.discount_per_unit_dkk || 0;
        const saleDiscountPerUnit = sku.sale_discount_per_unit_dkk || 0;

        // CRITICAL FIX: Revenue_gross skal matche Dashboard definition
        // Dashboard: bruttoRevenue = totalPrice - orderDiscountAmount - cancelledAmount
        // totalPrice = price * quantity, orderDiscountAmount = discountPerUnit * quantity
        const totalPrice = price * qty;
        const orderDiscountAmount = discountPerUnit * qty;
        const bruttoRevenue = totalPrice - orderDiscountAmount - cancelledAmountItem;

        revenueGross += bruttoRevenue;

        // SKU quantities (brutto excludes cancelled)
        const bruttoQty = qty - cancelledQtyItem;
        skuQtyGross += bruttoQty;

        // Cancellations
        cancelledQty += cancelledQtyItem;
        cancelledAmount += cancelledAmountItem;

        // Discounts (both order-level and sale discounts)
        const totalItemDiscount = (discountPerUnit + saleDiscountPerUnit) * qty;
        totalDiscounts += totalItemDiscount;
      });

      // CRITICAL: Process refunds separately based on refund_date
      if (refundData && refundData.length > 0) {
        refundData.forEach(refund => {
          const refundedQty = refund.refunded_qty || 0;
          const refundedAmount = refund.refunded_amount_dkk || 0;

          returnQty += refundedQty;
          returnAmount += refundedAmount;
          returnOrders.add(refund.order_id);
        });
      }

      // Net metrics = gross - refunds
      revenueNet = revenueGross - returnAmount;
      skuQtyNet = skuQtyGross - returnQty;

      // Get shipping metrics for orders created on this Danish date
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('shipping_price_dkk, shipping_discount_dkk')
        .eq('shop', shop)
        .gte('created_at', danishDateStart.toISOString())
        .lte('created_at', danishDateEnd.toISOString());

      let shippingRevenue = 0;
      let shippingDiscounts = 0;
      if (!orderError && orderData) {
        shippingRevenue = orderData.reduce((sum, o) => sum + (o.shipping_price_dkk || 0), 0);
        shippingDiscounts = orderData.reduce((sum, o) => sum + (o.shipping_discount_dkk || 0), 0);
      }

      // CRITICAL: Get shipping refunds that occurred on this date (based on refund_date)
      const { data: shippingRefundData, error: shippingRefundError } = await supabase
        .from('orders')
        .select('shipping_refund_dkk')
        .eq('shop', shop)
        .gt('shipping_refund_dkk', 0)
        .gte('refund_date', danishDateStart.toISOString())
        .lte('refund_date', danishDateEnd.toISOString());

      let shippingRefunds = 0;
      if (!shippingRefundError && shippingRefundData) {
        shippingRefunds = shippingRefundData.reduce((sum, o) => sum + (o.shipping_refund_dkk || 0), 0);
      }

      // Upsert metrics
      const metrics = {
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
        total_discounts: Math.round(totalDiscounts * 100) / 100
      };

      await upsertMetrics(supabase, shop, dateStr, metrics);

      console.log(`  ✅ ${shop}: ${uniqueOrders.size} orders, ${skuQtyGross} items, ${revenueGross.toFixed(2)} DKK`);
      results.push({ shop, date: dateStr, ...metrics });
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
