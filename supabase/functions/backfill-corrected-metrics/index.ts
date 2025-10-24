// Backfill daily_color_metrics and daily_sku_metrics with corrected calculations
// Processes dates in batches to avoid timeout

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { startDate, endDate, batchSize = 30 } = await req.json();

    console.log(`🔄 Starting backfill from ${startDate} to ${endDate} (batch size: ${batchSize})`);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    let currentDate = new Date(start);
    let processedDays = 0;
    const results = {
      colorMetrics: { success: 0, failed: 0 },
      skuMetrics: { success: 0, failed: 0 },
      errors: [] as string[]
    };

    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];

      try {
        // Process color metrics for this date
        const { error: colorError } = await supabase.rpc('aggregate_color_metrics_for_date', {
          target_date: dateStr
        });

        if (colorError) {
          console.error(`  ❌ Color metrics error for ${dateStr}:`, colorError);
          results.colorMetrics.failed++;
          results.errors.push(`Color ${dateStr}: ${colorError.message}`);
        } else {
          results.colorMetrics.success++;
        }

        // Process SKU metrics for this date
        const { error: skuError } = await supabase.rpc('aggregate_sku_metrics_for_date', {
          target_date: dateStr
        });

        if (skuError) {
          console.error(`  ❌ SKU metrics error for ${dateStr}:`, skuError);
          results.skuMetrics.failed++;
          results.errors.push(`SKU ${dateStr}: ${skuError.message}`);
        } else {
          results.skuMetrics.success++;
        }

        processedDays++;

        // Progress update every 10 days
        if (processedDays % 10 === 0) {
          const progress = (processedDays / totalDays * 100).toFixed(1);
          console.log(`  ✅ Processed ${processedDays} / ${totalDays} days (${progress}% complete)`);
        }

      } catch (error: any) {
        console.error(`  ❌ Error processing ${dateStr}:`, error);
        results.errors.push(`${dateStr}: ${error.message}`);
      }

      // Move to next date
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`✅ Backfill complete: ${processedDays} days processed`);
    console.log(`   Color metrics: ${results.colorMetrics.success} success, ${results.colorMetrics.failed} failed`);
    console.log(`   SKU metrics: ${results.skuMetrics.success} success, ${results.skuMetrics.failed} failed`);

    // Get summary statistics
    const { data: colorStats } = await supabase
      .from('daily_color_metrics')
      .select('solgt, cancelled, omsaetning_net, cancelled_amount', { count: 'exact' })
      .gte('metric_date', startDate)
      .lte('metric_date', endDate);

    const { data: skuStats } = await supabase
      .from('daily_sku_metrics')
      .select('solgt, cancelled, omsaetning_net, cancelled_amount', { count: 'exact' })
      .gte('metric_date', startDate)
      .lte('metric_date', endDate);

    const colorTotals = colorStats?.reduce((acc, row) => ({
      solgt: acc.solgt + (row.solgt || 0),
      cancelled: acc.cancelled + (row.cancelled || 0),
      omsaetning_net: acc.omsaetning_net + parseFloat(row.omsaetning_net || '0'),
      cancelled_amount: acc.cancelled_amount + parseFloat(row.cancelled_amount || '0')
    }), { solgt: 0, cancelled: 0, omsaetning_net: 0, cancelled_amount: 0 });

    const skuTotals = skuStats?.reduce((acc, row) => ({
      solgt: acc.solgt + (row.solgt || 0),
      cancelled: acc.cancelled + (row.cancelled || 0),
      omsaetning_net: acc.omsaetning_net + parseFloat(row.omsaetning_net || '0'),
      cancelled_amount: acc.cancelled_amount + parseFloat(row.cancelled_amount || '0')
    }), { solgt: 0, cancelled: 0, omsaetning_net: 0, cancelled_amount: 0 });

    return new Response(JSON.stringify({
      success: true,
      daysProcessed: processedDays,
      totalDays,
      results,
      statistics: {
        colorMetrics: {
          rows: colorStats?.length || 0,
          totals: colorTotals
        },
        skuMetrics: {
          rows: skuStats?.length || 0,
          totals: skuTotals
        }
      }
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("❌ Backfill error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
