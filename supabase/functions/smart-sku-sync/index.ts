import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false
  }
});
serve(async (req)=>{
  try {
    const { startDate, endDate, mode = 'auto' } = await req.json();
    // Default date range if not provided
    const start = startDate || '2024-09-30';
    const end = endDate || '2025-10-10';
    console.log(`🚀 Smart SKU Sync: ${start} to ${end} (mode: ${mode})`);
    // Step 1: Reset all failed SKU jobs in date range
    console.log('📋 Step 1: Resetting failed jobs...');
    const { error: resetError, count: resetCount } = await supabase.from('bulk_sync_jobs').update({
      status: 'pending',
      error_message: null,
      started_at: null,
      completed_at: null
    }).eq('object_type', 'skus').eq('status', 'failed').gte('start_date', start).lte('start_date', end);
    if (resetError) throw resetError;
    console.log(`✅ Reset ${resetCount || 0} failed jobs to pending`);
    // Step 2: Find missing data periods
    console.log('📋 Step 2: Finding missing data periods...');
    const { data: missingPeriods, error: missingError } = await supabase.rpc('find_missing_sku_periods', {
      start_date: start,
      end_date: end
    });
    if (missingError && missingError.code === 'PGRST202') {
      // Function doesn't exist, create it
      console.log('Creating RPC function...');
      await supabase.rpc('exec_sql', {
        sql: `
          CREATE OR REPLACE FUNCTION find_missing_sku_periods(start_date date, end_date date)
          RETURNS TABLE(shop text, missing_date date)
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN QUERY
            WITH date_range AS (
              SELECT generate_series(start_date, end_date, '1 day'::interval)::date as sync_date
            ),
            shops AS (
              SELECT unnest(ARRAY[
                'pompdelux-da.myshopify.com',
                'pompdelux-de.myshopify.com',
                'pompdelux-nl.myshopify.com',
                'pompdelux-int.myshopify.com',
                'pompdelux-chf.myshopify.com'
              ]) as shop_name
            ),
            expected AS (
              SELECT s.shop_name, d.sync_date
              FROM shops s
              CROSS JOIN date_range d
            ),
            actual AS (
              SELECT shop, DATE(created_at_original) as sync_date
              FROM skus
              WHERE created_at_original >= start_date
                AND created_at_original <= end_date + interval '1 day'
              GROUP BY shop, DATE(created_at_original)
              HAVING COUNT(*) > 0
            )
            SELECT e.shop_name, e.sync_date
            FROM expected e
            LEFT JOIN actual a ON e.shop_name = a.shop AND e.sync_date = a.sync_date
            WHERE a.sync_date IS NULL
            ORDER BY e.shop_name, e.sync_date;
          END;
          $$;
        `
      });
      // Try again
      const { data: retry } = await supabase.rpc('find_missing_sku_periods', {
        start_date: start,
        end_date: end
      });
      if (retry) {
        console.log(`Found ${retry.length} missing date/shop combinations`);
        await createMissingJobs(retry);
      }
    } else if (missingPeriods) {
      console.log(`Found ${missingPeriods.length} missing date/shop combinations`);
      await createMissingJobs(missingPeriods);
    }
    // Step 3: Process pending jobs
    console.log('📋 Step 3: Processing pending jobs...');
    let totalProcessed = 0;
    let iteration = 0;
    const maxIterations = 50;
    while(iteration < maxIterations){
      iteration++;
      // Call continue-orchestrator
      const response = await fetch(`${SUPABASE_URL}/functions/v1/continue-orchestrator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const result = await response.json();
      if (result.complete || result.stats?.pending === 0) {
        console.log('✅ All jobs completed!');
        break;
      }
      totalProcessed += result.batch?.processed || 0;
      console.log(`   Batch ${iteration}: ${result.batch?.processed || 0} jobs processed (${result.stats?.pending || 0} remaining)`);
      // Small delay between batches
      await new Promise((r)=>setTimeout(r, 2000));
    }
    // Step 4: Final verification
    const { data: finalStats } = await supabase.from('bulk_sync_jobs').select('status').eq('object_type', 'skus').gte('start_date', start).lte('start_date', end);
    const stats = {
      completed: finalStats?.filter((j)=>j.status === 'completed').length || 0,
      pending: finalStats?.filter((j)=>j.status === 'pending').length || 0,
      failed: finalStats?.filter((j)=>j.status === 'failed').length || 0,
      running: finalStats?.filter((j)=>j.status === 'running').length || 0
    };
    // Get coverage stats
    const { data: coverage } = await supabase.rpc('get_sku_coverage', {
      start_date: start,
      end_date: end
    }).catch(()=>({
        data: null
      }));
    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${totalProcessed} jobs in ${iteration} batches`,
      stats,
      coverage: coverage || [],
      dateRange: {
        start,
        end
      }
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error1) {
    console.error('❌ Error:', error1);
    return new Response(JSON.stringify({
      error: error1.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
async function createMissingJobs(missingPeriods) {
  const jobs = missingPeriods.map((p)=>({
      shop: p.shop,
      start_date: p.missing_date,
      end_date: p.missing_date,
      object_type: 'skus',
      status: 'pending',
      created_at: new Date().toISOString()
    }));
  // Insert in batches of 100
  for(let i = 0; i < jobs.length; i += 100){
    const batch = jobs.slice(i, i + 100);
    await supabase.from('bulk_sync_jobs').upsert(batch, {
      onConflict: 'shop,start_date,object_type'
    });
    if (error) {
      console.error(`Error creating jobs batch ${i / 100 + 1}:`, error);
    } else {
      console.log(`   Created ${batch.length} jobs (batch ${i / 100 + 1})`);
    }
  }
}
