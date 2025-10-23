import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Aggregate Color Metrics (daily_color_metrics)
 *
 * Purpose: Pre-aggregate daily color-level (artikelnummer) metrics
 * Schedule: Daily at 04:10 AM UTC (via pg_cron)
 *
 * Process:
 * 1. Aggregate yesterday's sales by artikelnummer from skus table
 * 2. Find SKUs updated yesterday and re-aggregate their historical dates
 * 3. Calculate revenue, quantities, returns, discounts per color
 * 4. Join with product_metadata for cost, price, season info
 * 5. Upsert into daily_color_metrics table
 */

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const { targetDate } = await req.json().catch(() => ({}));

    // Default to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const aggregateDate = targetDate ? new Date(targetDate) : yesterday;
    const dateStr = aggregateDate.toISOString().split('T')[0];

    console.log(`📊 Aggregating color metrics for: ${dateStr}`);

    // STEP 1: Aggregate today's data
    await aggregateColorDate(supabase, dateStr);
    console.log(`✅ Color metrics aggregated for ${dateStr}`);

    // STEP 2: Find SKUs updated today that need historical re-aggregation
    const danishDateStart = new Date(dateStr);
    danishDateStart.setUTCDate(danishDateStart.getUTCDate() - 1);
    danishDateStart.setUTCHours(22, 0, 0, 0);

    const danishDateEnd = new Date(dateStr);
    danishDateEnd.setUTCHours(21, 59, 59, 999);

    const datesToReaggregate = new Set<string>();
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: updateBatch, error } = await supabase
        .from('skus')
        .select('created_at_original, refund_date')
        .gte('updated_at', danishDateStart.toISOString())
        .lte('updated_at', danishDateEnd.toISOString())
        .order('updated_at', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (error) {
        console.error(`❌ Error fetching updated SKUs:`, error);
        break;
      }

      if (updateBatch && updateBatch.length > 0) {
        updateBatch.forEach(sku => {
          // Track created date (for sales)
          const createdDate = new Date(sku.created_at_original).toISOString().split('T')[0];
          if (createdDate !== dateStr) {
            datesToReaggregate.add(createdDate);
          }

          // Track refund date (if refund happened on different date)
          if (sku.refund_date) {
            const refundDate = new Date(sku.refund_date).toISOString().split('T')[0];
            if (refundDate !== dateStr) {
              datesToReaggregate.add(refundDate);
            }
          }
        });

        hasMore = updateBatch.length === batchSize;
        offset += batchSize;
      } else {
        hasMore = false;
      }
    }

    // STEP 3: Re-aggregate affected historical dates
    if (datesToReaggregate.size > 0) {
      console.log(`📅 Re-aggregating ${datesToReaggregate.size} dates: ${Array.from(datesToReaggregate).join(', ')}`);

      for (const affectedDate of datesToReaggregate) {
        console.log(`🔄 Re-aggregating ${affectedDate}...`);
        await aggregateColorDate(supabase, affectedDate);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      date: dateStr,
      reaggregated_dates: Array.from(datesToReaggregate)
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("❌ Color aggregation error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

async function aggregateColorDate(supabase: any, dateStr: string) {
  console.log(`  Processing color metrics for ${dateStr}...`);

  // Run the aggregation SQL (based on 20251020_backfill_daily_color_metrics_corrected.sql)
  const { error } = await supabase.rpc('aggregate_color_metrics_for_date', {
    target_date: dateStr
  });

  if (error) {
    console.error(`  ❌ Error aggregating color metrics:`, error);
    throw error;
  }

  console.log(`  ✅ Color metrics aggregated for ${dateStr}`);
}
