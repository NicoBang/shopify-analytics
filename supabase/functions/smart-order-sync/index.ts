import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

serve(async (req) => {
  try {
    const { startDate, endDate, mode = 'auto' } = await req.json();

    const start = startDate || '2024-09-30';
    const end = endDate || '2025-10-10';
    console.log(`🚀 Smart ORDER Sync: ${start} to ${end} (mode: ${mode})`);

    // Step 1: Reset failed ORDER jobs in date range
    console.log('📋 Step 1: Resetting failed order jobs...');
    const { error: resetError } = await supabase
      .from('bulk_sync_jobs')
      .update({
        status: 'pending',
        error_message: null,
        started_at: null,
        completed_at: null
      })
      .eq('object_type', 'orders')
      .eq('status', 'failed')
      .gte('start_date', start)
      .lte('start_date', end);
    if (resetError) throw resetError;

    // Step 2: Find missing order periods (by created_at on orders)
    console.log('📋 Step 2: Finding missing order periods...');
    let { data: missingPeriods, error: missingError } = await supabase.rpc('find_missing_order_periods', {
      start_date: start,
      end_date: end
    });

    if (missingError && (missingError as any).code === 'PGRST202') {
      // RPC missing - create it using exec_sql
      console.log('Creating RPC function find_missing_order_periods...');
      await supabase.rpc('exec_sql', {
        sql: `
          CREATE OR REPLACE FUNCTION find_missing_order_periods(start_date date, end_date date)
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
              SELECT shop, DATE(created_at) as sync_date
              FROM orders
              WHERE created_at >= start_date
                AND created_at < (end_date + interval '1 day')
              GROUP BY shop, DATE(created_at)
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
      const retry = await supabase.rpc('find_missing_order_periods', {
        start_date: start,
        end_date: end
      });
      // @ts-ignore
      missingPeriods = retry.data || [];
      console.log(`Found ${missingPeriods.length} missing date/shop combinations (after creating RPC)`);
    } else if (missingError) {
      throw missingError;
    } else {
      console.log(`Found ${missingPeriods?.length || 0} missing date/shop combinations`);
    }

    // Step 3: Create pending ORDER jobs (object_type='orders') in batches
    if (missingPeriods && missingPeriods.length > 0) {
      console.log('📋 Step 3: Creating missing order jobs...');
      const jobs = missingPeriods.map((p: any) => ({
        shop: p.shop,
        start_date: p.missing_date,
        end_date: p.missing_date,
        object_type: 'orders',
        status: 'pending',
        created_at: new Date().toISOString()
      }));

      for (let i = 0; i < jobs.length; i += 100) {
        const batch = jobs.slice(i, i + 100);
        const { error: upsertError } = await supabase
          .from('bulk_sync_jobs')
          .upsert(batch, { onConflict: 'shop,start_date,object_type' });
        if (upsertError) {
          console.error(`   ❌ Error creating jobs batch ${i / 100 + 1}:`, upsertError.message);
        } else {
          console.log(`   ✅ Created ${batch.length} jobs (batch ${i / 100 + 1})`);
        }
      }
    }

    // Step 4: Process pending ORDER jobs using orchestrator
    console.log('📋 Step 4: Processing pending order jobs via orchestrator...');
    let totalProcessed = 0;
    let iteration = 0;
    const maxIterations = 50;
    while (iteration < maxIterations) {
      iteration++;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/continue-orchestrator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ objectType: 'orders' })
      });
      const result = await response.json();
      if (result.complete || result.stats?.pending === 0) {
        console.log('✅ All order jobs completed!');
        break;
      }
      totalProcessed += result.batch?.processed || 0;
      console.log(`   Batch ${iteration}: ${result.batch?.processed || 0} jobs processed (${result.stats?.pending || 0} remaining)`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Step 5: Return summary
    const { data: finalStats } = await supabase
      .from('bulk_sync_jobs')
      .select('status')
      .eq('object_type', 'orders')
      .gte('start_date', start)
      .lte('start_date', end);
    const stats = {
      completed: finalStats?.filter((j: any) => j.status === 'completed').length || 0,
      pending: finalStats?.filter((j: any) => j.status === 'pending').length || 0,
      failed: finalStats?.filter((j: any) => j.status === 'failed').length || 0,
      running: finalStats?.filter((j: any) => j.status === 'running').length || 0
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed order jobs in ${iteration} batches`,
        stats,
        dateRange: { start, end }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('❌ Error (smart-order-sync):', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
