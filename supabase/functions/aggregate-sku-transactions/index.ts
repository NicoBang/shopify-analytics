// supabase/functions/aggregate-sku-transactions/index.ts
// V2 REWRITE: Aggregates daily SKU-level transaction data
// Purpose: Store full SKU granularity (with size) for flexible Color/SKU/Number analytics
// Replaces: aggregate-style-metrics (which had incorrect granularity)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SkuTransaction {
  sku: string;
  quantity_gross: number;
  quantity_net: number;
  quantity_returned: number;
  quantity_cancelled: number;
  revenue_gross: number;
  revenue_net: number;
  refunded_amount: number;
  cancelled_amount: number;
  order_discounts: number;
  sale_discounts: number;
  total_discounts: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { targetDate } = await req.json().catch(() => ({}));

    // Default to yesterday if no date specified
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const aggregateDate = targetDate ? new Date(targetDate) : yesterday;
    const dateStr = aggregateDate.toISOString().split('T')[0];

    // Danish timezone: UTC+2 (summer) or UTC+1 (winter)
    // For simplicity, use UTC+2 (matches existing logic)
    const danishDateStart = new Date(dateStr);
    danishDateStart.setUTCHours(22, 0, 0, 0); // 00:00 Danish time = 22:00 UTC previous day

    const danishDateEnd = new Date(dateStr);
    danishDateEnd.setUTCDate(danishDateEnd.getUTCDate() + 1);
    danishDateEnd.setUTCHours(21, 59, 59, 999); // 23:59:59 Danish time = 21:59:59 UTC next day

    console.log(`⚡ Aggregating SKU transactions for Danish date: ${dateStr}`);
    console.log(`   UTC range: ${danishDateStart.toISOString()} to ${danishDateEnd.toISOString()}`);

    const shops = [
      'pompdelux-da.myshopify.com',
      'pompdelux-de.myshopify.com',
      'pompdelux-nl.myshopify.com',
      'pompdelux-int.myshopify.com',
      'pompdelux-chf.myshopify.com'
    ];

    const results = [];

    for (const shop of shops) {
      console.log(`  📊 Processing ${shop}...`);

      // STEP 1: Fetch SKU data for orders created on this Danish calendar date
      const { data: skuData, error: skuError } = await supabase
        .from('skus')
        .select(`
          sku,
          quantity,
          cancelled_qty,
          price_dkk,
          cancelled_amount_dkk,
          discount_per_unit_dkk,
          sale_discount_per_unit_dkk
        `)
        .eq('shop', shop)
        .gte('created_at_original', danishDateStart.toISOString())
        .lte('created_at_original', danishDateEnd.toISOString());

      if (skuError) {
        console.error(`❌ Error fetching SKUs for ${shop}:`, skuError);
        continue;
      }

      // STEP 2: Fetch refunds that occurred on this date (based on refund_date)
      const { data: refundData, error: refundError } = await supabase
        .from('skus')
        .select('sku, refunded_qty, refunded_amount_dkk')
        .eq('shop', shop)
        .gt('refunded_qty', 0)
        .gte('refund_date', danishDateStart.toISOString())
        .lte('refund_date', danishDateEnd.toISOString());

      if (refundError) {
        console.error(`❌ Error fetching refunds for ${shop}:`, refundError);
        continue;
      }

      if (!skuData || skuData.length === 0) {
        console.log(`  ℹ️ No order data for ${shop} on ${dateStr}`);

        // Still process refunds if they exist
        if (!refundData || refundData.length === 0) {
          continue;
        }
      }

      // STEP 3: Aggregate by full SKU (preserving size/variant)
      const skuTransactions = new Map<string, SkuTransaction>();

      // Process orders created on this date
      if (skuData && skuData.length > 0) {
        for (const item of skuData) {
          const sku = item.sku;
          const quantity = parseFloat(item.quantity) || 0;
          const cancelledQty = parseFloat(item.cancelled_qty) || 0;
          const priceDkk = parseFloat(item.price_dkk) || 0;
          const cancelledAmountDkk = parseFloat(item.cancelled_amount_dkk) || 0;
          const discountPerUnitDkk = parseFloat(item.discount_per_unit_dkk) || 0;
          const saleDiscountPerUnitDkk = parseFloat(item.sale_discount_per_unit_dkk) || 0;

          // CRITICAL FIX: Match V1 revenue calculation from metadata.js:1050-1064
          // V1 logic: price_dkk ALREADY includes sale discounts (compareAtPrice → sellingPrice)
          // Therefore: revenue_gross = price_dkk × quantity (no discount subtraction)
          const quantityGross = quantity - cancelledQty; // Gross excludes cancelled
          const revenueGross = priceDkk * quantityGross; // ✅ Price already discounted

          // Discount tracking (for transparency, not subtracted from revenue)
          const orderDiscounts = discountPerUnitDkk * quantityGross;
          const saleDiscounts = saleDiscountPerUnitDkk * quantityGross;
          const totalDiscounts = orderDiscounts + saleDiscounts;

          if (!skuTransactions.has(sku)) {
            skuTransactions.set(sku, {
              sku,
              quantity_gross: 0,
              quantity_net: 0,
              quantity_returned: 0,
              quantity_cancelled: 0,
              revenue_gross: 0,
              revenue_net: 0,
              refunded_amount: 0,
              cancelled_amount: 0,
              order_discounts: 0,
              sale_discounts: 0,
              total_discounts: 0,
            });
          }

          const txn = skuTransactions.get(sku)!;
          txn.quantity_gross += quantityGross;
          txn.quantity_cancelled += cancelledQty;
          txn.revenue_gross += revenueGross;
          txn.cancelled_amount += cancelledAmountDkk;
          txn.order_discounts += orderDiscounts;
          txn.sale_discounts += saleDiscounts;
          txn.total_discounts += totalDiscounts;
        }
      }

      // Process refunds that occurred on this date
      if (refundData && refundData.length > 0) {
        console.log(`  📦 Processing ${refundData.length} refunds for ${shop}...`);

        for (const refund of refundData) {
          const sku = refund.sku;
          const refundedQty = parseFloat(refund.refunded_qty) || 0;
          const refundedAmountDkk = parseFloat(refund.refunded_amount_dkk) || 0;

          if (!skuTransactions.has(sku)) {
            skuTransactions.set(sku, {
              sku,
              quantity_gross: 0,
              quantity_net: 0,
              quantity_returned: 0,
              quantity_cancelled: 0,
              revenue_gross: 0,
              revenue_net: 0,
              refunded_amount: 0,
              cancelled_amount: 0,
              order_discounts: 0,
              sale_discounts: 0,
              total_discounts: 0,
            });
          }

          const txn = skuTransactions.get(sku)!;
          txn.quantity_returned += refundedQty;
          txn.refunded_amount += refundedAmountDkk;
        }
      }

      // STEP 4: Calculate net metrics (gross - returned)
      for (const txn of skuTransactions.values()) {
        txn.quantity_net = txn.quantity_gross - txn.quantity_returned;
        txn.revenue_net = txn.revenue_gross - txn.refunded_amount;
      }

      // STEP 5: Prepare for upsert (round to 2 decimals)
      const transactionsArray = Array.from(skuTransactions.values()).map(txn => ({
        shop,
        metric_date: dateStr,
        sku: txn.sku,
        quantity_gross: txn.quantity_gross,
        quantity_net: txn.quantity_net,
        quantity_returned: txn.quantity_returned,
        quantity_cancelled: txn.quantity_cancelled,
        revenue_gross: Math.round(txn.revenue_gross * 100) / 100,
        revenue_net: Math.round(txn.revenue_net * 100) / 100,
        refunded_amount: Math.round(txn.refunded_amount * 100) / 100,
        cancelled_amount: Math.round(txn.cancelled_amount * 100) / 100,
        order_discounts: Math.round(txn.order_discounts * 100) / 100,
        sale_discounts: Math.round(txn.sale_discounts * 100) / 100,
        total_discounts: Math.round(txn.total_discounts * 100) / 100,
      }));

      // STEP 6: Batch upsert to database
      if (transactionsArray.length > 0) {
        const { error: upsertError } = await supabase
          .from('daily_sku_transactions')
          .upsert(transactionsArray, {
            onConflict: 'shop,metric_date,sku'
          });

        if (upsertError) {
          console.error(`❌ Error upserting SKU transactions for ${shop}:`, upsertError);
          continue;
        }

        console.log(`  ✅ ${shop}: ${transactionsArray.length} SKU transactions aggregated`);
      } else {
        console.log(`  ℹ️ ${shop}: No transactions to aggregate`);
      }

      results.push({
        shop,
        transactions: transactionsArray.length,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      date: dateStr,
      shops: results.length,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("❌ Aggregation error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
