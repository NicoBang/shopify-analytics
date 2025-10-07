import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Watchdog Cleanup Function
 *
 * Purpose: Automatically mark stalled "running" jobs as failed
 * Trigger: Supabase cron job every 2 minutes
 *
 * This prevents the orchestrator from getting stuck waiting for
 * jobs that have actually timed out but weren't marked as failed.
 */

serve(async (req: Request): Promise<Response> => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🐕 Watchdog: Checking for stale running jobs...");

    // Mark jobs running >2 minutes as failed
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: staleJobs, error } = await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        error_message: "Edge Function timeout detected by watchdog - job exceeded 2 minute limit",
        completed_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("started_at", twoMinutesAgo)
      .select("shop, start_date, object_type, started_at");

    if (error) {
      console.error("❌ Watchdog error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const cleanedCount = staleJobs?.length || 0;

    if (cleanedCount > 0) {
      console.log(`🧹 Watchdog cleaned up ${cleanedCount} stale jobs:`);
      staleJobs?.forEach(job => {
        const staleDuration = Math.round(
          (Date.now() - new Date(job.started_at).getTime()) / 1000
        );
        console.log(`   - ${job.shop} ${job.start_date} ${job.object_type} (stalled ${staleDuration}s)`);
      });
    } else {
      console.log("✅ Watchdog: No stale jobs found");
    }

    return new Response(
      JSON.stringify({
        success: true,
        cleaned: cleanedCount,
        jobs: staleJobs || [],
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Watchdog exception:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
