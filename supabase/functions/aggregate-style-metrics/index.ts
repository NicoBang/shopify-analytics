// supabase/functions/aggregate-style-metrics/index.ts
// Aggregates daily metrics for Color/SKU/Number Analytics

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Color mapping from tags
const COLOR_MAP: { [key: string]: string } = {
  // English tags
  "black": "BLACK",
  "white": "WHITE",
  "blue": "BLUE",
  "navy": "NAVY",
  "pink": "PINK",
  "red": "RED",
  "green": "GREEN",
  "yellow": "YELLOW",
  "grey": "GREY",
  "brown": "BROWN",
  "purple": "PURPLE",
  "orange": "ORANGE",
  "beige": "BEIGE",

  // Danish tags
  "sort": "BLACK",
  "hvid": "WHITE",
  "blå": "BLUE",
  "rosa": "PINK",
  "rød": "RED",
  "grøn": "GREEN",
  "gul": "YELLOW",
  "grå": "GREY",
  "brun": "BROWN",
  "lilla": "PURPLE",
  "lyserød": "PINK",
};

function extractColorFromTags(tags: string | null): string {
  if (!tags) return "OTHER";

  const tagsLower = tags.toLowerCase();
  for (const [keyword, color] of Object.entries(COLOR_MAP)) {
    if (tagsLower.includes(keyword)) {
      return color;
    }
  }
  return "OTHER";
}

function extractArtikelnummer(sku: string): string {
  // First 4 digits: "5132-8-110-51" -> "5132"
  const parts = sku.split("-");
  return parts[0] || "UNKNOWN";
}

function extractNumber(sku: string): string {
  // Last 2 digits: "5132-8-110-51" -> "51"
  const parts = sku.split("-");
  return parts[parts.length - 1] || "UNKNOWN";
}

async function upsertColorMetrics(supabase: any, shop: string, date: string, metrics: any[]) {
  for (const metric of metrics) {
    await supabase
      .from("daily_color_metrics")
      .upsert({
        shop,
        metric_date: date,
        farve: metric.farve,
        quantity_gross: metric.quantity_gross,
        quantity_net: metric.quantity_net,
        quantity_returned: metric.quantity_returned,
        quantity_cancelled: metric.quantity_cancelled,
        revenue_gross: metric.revenue_gross,
        revenue_net: metric.revenue_net,
        return_amount: metric.return_amount,
        cancelled_amount: metric.cancelled_amount,
        total_discounts: metric.total_discounts,
      }, {
        onConflict: "shop,metric_date,farve"
      });
  }
}

async function upsertSkuMetrics(supabase: any, shop: string, date: string, metrics: any[]) {
  for (const metric of metrics) {
    await supabase
      .from("daily_sku_metrics")
      .upsert({
        shop,
        metric_date: date,
        artikelnummer: metric.artikelnummer,
        quantity_gross: metric.quantity_gross,
        quantity_net: metric.quantity_net,
        quantity_returned: metric.quantity_returned,
        quantity_cancelled: metric.quantity_cancelled,
        revenue_gross: metric.revenue_gross,
        revenue_net: metric.revenue_net,
        return_amount: metric.return_amount,
        cancelled_amount: metric.cancelled_amount,
        total_discounts: metric.total_discounts,
      }, {
        onConflict: "shop,metric_date,artikelnummer"
      });
  }
}

async function upsertNumberMetrics(supabase: any, shop: string, date: string, metrics: any[]) {
  for (const metric of metrics) {
    await supabase
      .from("daily_number_metrics")
      .upsert({
        shop,
        metric_date: date,
        number: metric.number,
        quantity_gross: metric.quantity_gross,
        quantity_net: metric.quantity_net,
        quantity_returned: metric.quantity_returned,
        quantity_cancelled: metric.quantity_cancelled,
        revenue_gross: metric.revenue_gross,
        revenue_net: metric.revenue_net,
        return_amount: metric.return_amount,
        cancelled_amount: metric.cancelled_amount,
        total_discounts: metric.total_discounts,
      }, {
        onConflict: "shop,metric_date,number"
      });
  }
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

    // CRITICAL FIX: Dansk tid er UTC+2 (sommertid CEST)
    // For at få data for dansk 12. oktober: 2025-09-11T22:00:00Z til 2025-09-12T21:59:59Z
    const danishDateStart = new Date(dateStr);
    danishDateStart.setUTCDate(danishDateStart.getUTCDate() - 1); // Start dagen før
    danishDateStart.setUTCHours(22, 0, 0, 0); // 00:00 dansk tid = 22:00 UTC dagen før

    const danishDateEnd = new Date(dateStr);
    danishDateEnd.setUTCHours(21, 59, 59, 999); // 23:59:59 dansk tid = 21:59:59 UTC samme dag

    console.log(`⚡ Aggregating style metrics for Danish date: ${dateStr}`);
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

      // Fetch SKU data (orders created on this Danish calendar date)
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

      // CRITICAL: Fetch refunds separately based on refund_date (not created_at_original)
      const { data: refundData, error: refundError } = await supabase
        .from('skus')
        .select('sku, refunded_qty, refunded_amount_dkk')
        .eq('shop', shop)
        .gt('refunded_qty', 0)
        .gte('refund_date', danishDateStart.toISOString())
        .lte('refund_date', danishDateEnd.toISOString());

      if (skuError) {
        console.error(`❌ Error fetching SKUs for ${shop}:`, skuError);
        continue;
      }

      if (refundError) {
        console.error(`❌ Error fetching refunds for ${shop}:`, refundError);
        continue;
      }

      if (!skuData || skuData.length === 0) {
        console.log(`  ℹ️ No data for ${shop} on ${dateStr}`);
        continue;
      }

      // Fetch metadata for color extraction
      const uniqueArtikelnummers = [...new Set(skuData.map(s => extractArtikelnummer(s.sku)))];
      const skuPatterns = uniqueArtikelnummers.map(a => `${a}%`);

      let orQuery = skuPatterns.map(pattern => `sku.like.${pattern}`).join(',');

      const { data: metadataData } = await supabase
        .from('product_metadata')
        .select('sku, tags')
        .or(orQuery);

      // Build metadata lookup
      const metadataMap = new Map();
      metadataData?.forEach((m: any) => {
        metadataMap.set(m.sku, m.tags);
      });

      // Aggregate by Color
      const colorMetrics = new Map();

      // Aggregate by SKU (artikelnummer)
      const skuMetrics = new Map();

      // Aggregate by Number
      const numberMetrics = new Map();

      // STEP 1: Process orders created on this date (revenue + cancellations)
      for (const sku of skuData) {
        const artikelnummer = extractArtikelnummer(sku.sku);
        const number = extractNumber(sku.sku);
        const tags = metadataMap.get(sku.sku);
        const farve = extractColorFromTags(tags);

        const quantity = parseFloat(sku.quantity) || 0;
        const cancelledQty = parseFloat(sku.cancelled_qty) || 0;
        const priceDkk = parseFloat(sku.price_dkk) || 0;
        const cancelledAmountDkk = parseFloat(sku.cancelled_amount_dkk) || 0;
        const discountPerUnitDkk = parseFloat(sku.discount_per_unit_dkk) || 0;
        const saleDiscountPerUnitDkk = parseFloat(sku.sale_discount_per_unit_dkk) || 0;

        // CRITICAL FIX: Revenue_gross skal matche Dashboard definition
        // Dashboard: bruttoRevenue = totalPrice - orderDiscountAmount - cancelledAmount
        const totalPrice = priceDkk * quantity;
        const orderDiscountAmount = discountPerUnitDkk * quantity;
        const revenueGross = totalPrice - orderDiscountAmount - cancelledAmountDkk;
        const totalDiscounts = quantity * (discountPerUnitDkk + saleDiscountPerUnitDkk);

        // Aggregate COLOR
        if (!colorMetrics.has(farve)) {
          colorMetrics.set(farve, {
            farve,
            quantity_gross: 0,
            quantity_net: 0,
            quantity_returned: 0,
            quantity_cancelled: 0,
            revenue_gross: 0,
            revenue_net: 0,
            return_amount: 0,
            cancelled_amount: 0,
            total_discounts: 0,
          });
        }
        const cm = colorMetrics.get(farve);
        cm.quantity_gross += quantity - cancelledQty; // Brutto excludes cancelled
        cm.quantity_cancelled += cancelledQty;
        cm.revenue_gross += revenueGross;
        cm.cancelled_amount += cancelledAmountDkk;
        cm.total_discounts += totalDiscounts;

        // Aggregate SKU (artikelnummer)
        if (!skuMetrics.has(artikelnummer)) {
          skuMetrics.set(artikelnummer, {
            artikelnummer,
            quantity_gross: 0,
            quantity_net: 0,
            quantity_returned: 0,
            quantity_cancelled: 0,
            revenue_gross: 0,
            revenue_net: 0,
            return_amount: 0,
            cancelled_amount: 0,
            total_discounts: 0,
          });
        }
        const sm = skuMetrics.get(artikelnummer);
        sm.quantity_gross += quantity - cancelledQty; // Brutto excludes cancelled
        sm.quantity_cancelled += cancelledQty;
        sm.revenue_gross += revenueGross;
        sm.cancelled_amount += cancelledAmountDkk;
        sm.total_discounts += totalDiscounts;

        // Aggregate NUMBER
        if (!numberMetrics.has(number)) {
          numberMetrics.set(number, {
            number,
            quantity_gross: 0,
            quantity_net: 0,
            quantity_returned: 0,
            quantity_cancelled: 0,
            revenue_gross: 0,
            revenue_net: 0,
            return_amount: 0,
            cancelled_amount: 0,
            total_discounts: 0,
          });
        }
        const nm = numberMetrics.get(number);
        nm.quantity_gross += quantity - cancelledQty; // Brutto excludes cancelled
        nm.quantity_cancelled += cancelledQty;
        nm.revenue_gross += revenueGross;
        nm.cancelled_amount += cancelledAmountDkk;
        nm.total_discounts += totalDiscounts;
      }

      // STEP 2: Process refunds that happened on this date (based on refund_date)
      if (refundData && refundData.length > 0) {
        console.log(`  📦 Processing ${refundData.length} refunds for ${shop}...`);

        for (const refund of refundData) {
          const artikelnummer = extractArtikelnummer(refund.sku);
          const number = extractNumber(refund.sku);
          const tags = metadataMap.get(refund.sku);
          const farve = extractColorFromTags(tags);

          const refundedQty = parseFloat(refund.refunded_qty) || 0;
          const refundedAmountDkk = parseFloat(refund.refunded_amount_dkk) || 0;

          // Update COLOR metrics
          if (!colorMetrics.has(farve)) {
            colorMetrics.set(farve, {
              farve,
              quantity_gross: 0,
              quantity_net: 0,
              quantity_returned: 0,
              quantity_cancelled: 0,
              revenue_gross: 0,
              revenue_net: 0,
              return_amount: 0,
              cancelled_amount: 0,
              total_discounts: 0,
            });
          }
          const cm = colorMetrics.get(farve);
          cm.quantity_returned += refundedQty;
          cm.return_amount += refundedAmountDkk;

          // Update SKU metrics
          if (!skuMetrics.has(artikelnummer)) {
            skuMetrics.set(artikelnummer, {
              artikelnummer,
              quantity_gross: 0,
              quantity_net: 0,
              quantity_returned: 0,
              quantity_cancelled: 0,
              revenue_gross: 0,
              revenue_net: 0,
              return_amount: 0,
              cancelled_amount: 0,
              total_discounts: 0,
            });
          }
          const sm = skuMetrics.get(artikelnummer);
          sm.quantity_returned += refundedQty;
          sm.return_amount += refundedAmountDkk;

          // Update NUMBER metrics
          if (!numberMetrics.has(number)) {
            numberMetrics.set(number, {
              number,
              quantity_gross: 0,
              quantity_net: 0,
              quantity_returned: 0,
              quantity_cancelled: 0,
              revenue_gross: 0,
              revenue_net: 0,
              return_amount: 0,
              cancelled_amount: 0,
              total_discounts: 0,
            });
          }
          const nm = numberMetrics.get(number);
          nm.quantity_returned += refundedQty;
          nm.return_amount += refundedAmountDkk;
        }
      }

      // STEP 3: Calculate net metrics (gross - refunds)
      for (const cm of colorMetrics.values()) {
        cm.quantity_net = cm.quantity_gross - cm.quantity_returned;
        cm.revenue_net = cm.revenue_gross - cm.return_amount;
      }
      for (const sm of skuMetrics.values()) {
        sm.quantity_net = sm.quantity_gross - sm.quantity_returned;
        sm.revenue_net = sm.revenue_gross - sm.return_amount;
      }
      for (const nm of numberMetrics.values()) {
        nm.quantity_net = nm.quantity_gross - nm.quantity_returned;
        nm.revenue_net = nm.revenue_gross - nm.return_amount;
      }

      // Round and upsert
      const colorMetricsArray = Array.from(colorMetrics.values()).map(m => ({
        ...m,
        revenue_gross: Math.round(m.revenue_gross * 100) / 100,
        revenue_net: Math.round(m.revenue_net * 100) / 100,
        return_amount: Math.round(m.return_amount * 100) / 100,
        cancelled_amount: Math.round(m.cancelled_amount * 100) / 100,
        total_discounts: Math.round(m.total_discounts * 100) / 100,
      }));

      const skuMetricsArray = Array.from(skuMetrics.values()).map(m => ({
        ...m,
        revenue_gross: Math.round(m.revenue_gross * 100) / 100,
        revenue_net: Math.round(m.revenue_net * 100) / 100,
        return_amount: Math.round(m.return_amount * 100) / 100,
        cancelled_amount: Math.round(m.cancelled_amount * 100) / 100,
        total_discounts: Math.round(m.total_discounts * 100) / 100,
      }));

      const numberMetricsArray = Array.from(numberMetrics.values()).map(m => ({
        ...m,
        revenue_gross: Math.round(m.revenue_gross * 100) / 100,
        revenue_net: Math.round(m.revenue_net * 100) / 100,
        return_amount: Math.round(m.return_amount * 100) / 100,
        cancelled_amount: Math.round(m.cancelled_amount * 100) / 100,
        total_discounts: Math.round(m.total_discounts * 100) / 100,
      }));

      await upsertColorMetrics(supabase, shop, dateStr, colorMetricsArray);
      await upsertSkuMetrics(supabase, shop, dateStr, skuMetricsArray);
      await upsertNumberMetrics(supabase, shop, dateStr, numberMetricsArray);

      results.push({
        shop,
        colors: colorMetricsArray.length,
        skus: skuMetricsArray.length,
        numbers: numberMetricsArray.length,
      });

      console.log(`  ✅ ${shop}: ${colorMetricsArray.length} colors, ${skuMetricsArray.length} SKUs, ${numberMetricsArray.length} numbers`);
    }

    return new Response(JSON.stringify({
      success: true,
      date: dateStr,
      shops: results.length,
      metrics: results,
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
