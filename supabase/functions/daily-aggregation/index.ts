// Daily Aggregation Edge Function
// Runs daily at 07:00 Copenhagen time to aggregate metrics for:
// 1. Yesterday (new orders)
// 2. Last 90 days (new refunds on old orders)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 Starting daily aggregation...');

    // Calculate dates in Copenhagen timezone
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const last90Days = new Date(now);
    last90Days.setDate(last90Days.getDate() - 90);

    // Format dates as YYYY-MM-DD
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const last90DaysStr = last90Days.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    console.log(`📅 Aggregating:
  - Yesterday (new orders): ${yesterdayStr}
  - Last 90 days (refunds): ${last90DaysStr} to ${todayStr}
`);

    const results = {
      yesterday: null as any,
      refundDates: [] as any[],
      errors: [] as any[],
    };

    // 1. Aggregate yesterday (new orders)
    console.log(`\n📊 Aggregating yesterday (${yesterdayStr})...`);
    try {
      const { data, error } = await supabase.functions.invoke('aggregate-daily-metrics', {
        body: { targetDate: yesterdayStr },
      });

      if (error) throw error;
      results.yesterday = { date: yesterdayStr, success: true, data };
      console.log(`✅ Yesterday aggregated successfully`);
    } catch (error: any) {
      console.error(`❌ Error aggregating yesterday:`, error);
      results.errors.push({ date: yesterdayStr, error: error.message });
      results.yesterday = { date: yesterdayStr, success: false, error: error.message };
    }

    // 2. Aggregate last 90 days (for new refunds)
    console.log(`\n🔄 Aggregating last 90 days for refunds (${last90DaysStr} to ${todayStr})...`);

    // Generate array of dates to process
    const datesToProcess: string[] = [];
    const currentDate = new Date(last90Days);
    while (currentDate <= now) {
      datesToProcess.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`📋 Processing ${datesToProcess.length} dates for refunds...`);

    // Process in batches to avoid timeout
    const batchSize = 10;
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < datesToProcess.length; i += batchSize) {
      const batch = datesToProcess.slice(i, i + batchSize);

      console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(datesToProcess.length / batchSize)} (${batch.length} dates)...`);

      // Process batch in parallel
      const batchPromises = batch.map(async (date) => {
        try {
          const { data, error } = await supabase.functions.invoke('aggregate-daily-metrics', {
            body: { targetDate: date },
          });

          if (error) throw error;

          successCount++;
          return { date, success: true, data };
        } catch (error: any) {
          console.error(`❌ Error aggregating ${date}:`, error.message);
          errorCount++;
          results.errors.push({ date, error: error.message });
          return { date, success: false, error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.refundDates.push(...batchResults);
      processedCount += batch.length;

      console.log(`✅ Batch completed: ${successCount}/${processedCount} successful, ${errorCount} errors`);
    }

    console.log(`\n✅ Daily aggregation completed:
  - Yesterday: ${results.yesterday?.success ? 'SUCCESS' : 'FAILED'}
  - Refund dates: ${successCount}/${datesToProcess.length} successful
  - Total errors: ${results.errors.length}
`);

    return new Response(
      JSON.stringify({
        success: results.errors.length === 0,
        message: `Daily aggregation completed with ${results.errors.length} errors`,
        results: {
          yesterday: results.yesterday,
          refundDates: {
            total: datesToProcess.length,
            successful: successCount,
            failed: errorCount,
          },
          errors: results.errors,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('💥 Error in daily aggregation:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
