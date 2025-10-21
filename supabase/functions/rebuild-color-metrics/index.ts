// rebuild-color-metrics Edge Function - Rebuild daily_color_metrics with corrected logic
// Processes one day at a time to avoid timeout
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { date } = await req.json();

    if (!date) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: date (YYYY-MM-DD)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔄 Rebuilding daily_color_metrics for ${date}...`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Delete old data for this date
    const { error: deleteError } = await supabase
      .from('daily_color_metrics')
      .delete()
      .eq('metric_date', date);

    if (deleteError) {
      console.error('❌ Delete error:', deleteError);
      throw deleteError;
    }

    console.log(`  Deleted old data for ${date}`);

    // Rebuild with CORRECTED logic (same as migration but for single day)
    const { error: rebuildError } = await supabase.rpc('rebuild_color_metrics_for_date', { target_date: date });

    if (rebuildError) {
      console.error('❌ Rebuild error:', rebuildError);
      throw rebuildError;
    }

    // Verify result
    const { data: verification, error: verifyError } = await supabase
      .from('daily_color_metrics')
      .select('solgt')
      .eq('metric_date', date);

    if (verifyError) {
      console.error('❌ Verification error:', verifyError);
      throw verifyError;
    }

    const totalSolgt = verification?.reduce((sum, row) => sum + (row.solgt || 0), 0) || 0;

    console.log(`✅ Rebuilt ${date}: ${totalSolgt} solgt`);

    return new Response(
      JSON.stringify({
        success: true,
        date,
        total_solgt: totalSolgt,
        rows: verification?.length || 0
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
