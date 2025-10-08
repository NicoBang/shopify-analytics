import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Continue Orchestrator
 *
 * Purpose: Process next batch of pending jobs from bulk_sync_jobs table
 * Design: Stateless - can be called repeatedly to make progress
 *
 * Strategy:
 * 1. Find pending jobs (never processed)
 * 2. Process small batch (20 jobs) to avoid timeout
 * 3. Return early with progress status
 * 4. Can be called again to continue
 *
 * This avoids Edge Function timeout issues by doing incremental work.
 */

const BATCH_SIZE = 20; // Process 20 jobs per invocation (completes in ~2-3 minutes)

serve(async (req: Request): Promise<Response> => {
  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🔄 Continue Orchestrator: Starting batch processing...");

    // Step 1: Cleanup any stale "running" jobs first
    const staleCleanup = await cleanupStaleJobs(supabase);
    if (staleCleanup > 0) {
      console.log(`🧹 Cleaned up ${staleCleanup} stale jobs`);
    }

    // Step 2: Get next batch of pending jobs
    const { data: pendingJobs, error } = await supabase
      .from("bulk_sync_jobs")
      .select("*")
      .eq("status", "pending")
      .order("start_date", { ascending: true })
      .order("shop", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`Failed to fetch pending jobs: ${error.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log("✅ No pending jobs found - sync complete!");

      // Get final stats
      const { data: allJobs } = await supabase
        .from("bulk_sync_jobs")
        .select("status");

      const stats = {
        completed: allJobs?.filter((j) => j.status === "completed").length || 0,
        failed: allJobs?.filter((j) => j.status === "failed").length || 0,
        pending: 0,
      };

      return new Response(
        JSON.stringify({
          complete: true,
          message: "All jobs processed!",
          stats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Processing ${pendingJobs.length} pending jobs...`);

    // Step 3: Process each job sequentially
    const results = [];
    for (const job of pendingJobs) {
      const jobResult = await processJob(job, supabase);
      results.push(jobResult);

      // Log progress
      if (results.length % 5 === 0) {
        console.log(`   Progress: ${results.length}/${pendingJobs.length} jobs processed`);
      }
    }

    // Step 4: Calculate remaining work
    const { data: remainingJobs } = await supabase
      .from("bulk_sync_jobs")
      .select("status");

    const remaining = {
      completed: remainingJobs?.filter((j) => j.status === "completed").length || 0,
      failed: remainingJobs?.filter((j) => j.status === "failed").length || 0,
      pending: remainingJobs?.filter((j) => j.status === "pending").length || 0,
      running: remainingJobs?.filter((j) => j.status === "running").length || 0,
    };

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`✅ Batch complete: ${results.filter(r => r.success).length}/${results.length} successful`);
    console.log(`📊 Remaining: ${remaining.pending} pending, ${remaining.completed} completed, ${remaining.failed} failed`);
    console.log(`⏱️  Duration: ${duration}s`);

    return new Response(
      JSON.stringify({
        complete: remaining.pending === 0,
        message: remaining.pending > 0
          ? `Processed ${results.length} jobs - ${remaining.pending} remaining`
          : "All jobs processed!",
        batch: {
          processed: results.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
        stats: remaining,
        durationSeconds: duration,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Continue orchestrator error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function cleanupStaleJobs(supabase: any): Promise<number> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: staleJobs } = await supabase
    .from("bulk_sync_jobs")
    .update({
      status: "failed",
      error_message: "Job timeout - exceeded 2 minute limit",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", twoMinutesAgo)
    .select();

  return staleJobs?.length || 0;
}

async function processJob(job: any, supabase: any): Promise<any> {
  const { shop, start_date, end_date, object_type } = job;

  try {
    // Mark as running
    await supabase
      .from("bulk_sync_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("shop", shop)
      .eq("start_date", start_date)
      .eq("object_type", object_type);

    // Determine which function to call
    let functionName: string;
    if (object_type === "orders") {
      functionName = "bulk-sync-orders";
    } else if (object_type === "skus") {
      functionName = "bulk-sync-skus";
    } else if (object_type === "refunds") {
      functionName = "bulk-sync-refund-orders";
    } else {
      throw new Error(`Unknown object_type: ${object_type}`);
    }

    // Call the Edge Function
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/${functionName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop,
          startDate: start_date,
          endDate: end_date || start_date,
          includeRefunds: object_type === "orders" || object_type === "refunds",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${functionName} failed: ${errorText}`);
    }

    const result = await response.json();

    // Mark as completed
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        orders_synced: result.orders_synced || result.orderCount || 0,
        skus_synced: result.skus_synced || result.skuCount || 0,
        records_processed: result.records_processed || 0,
      })
      .eq("shop", shop)
      .eq("start_date", start_date)
      .eq("object_type", object_type);

    console.log(`✅ ${shop} ${start_date} ${object_type} - Success`);

    return {
      shop,
      date: start_date,
      type: object_type,
      success: true,
    };
  } catch (error: any) {
    console.error(`❌ ${shop} ${start_date} ${object_type} - Failed:`, error.message);

    // Mark as failed
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error.message,
      })
      .eq("shop", shop)
      .eq("start_date", start_date)
      .eq("object_type", object_type);

    return {
      shop,
      date: start_date,
      type: object_type,
      success: false,
      error: error.message,
    };
  }
}
