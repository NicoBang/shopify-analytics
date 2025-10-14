import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Continue Orchestrator
 * 
 * Purpose: Process next batch of pending jobs from bulk_sync_jobs table
 * Design: Stateless - can be called repeatedly (by cron or manually)
 * 
 * Strategy:
 * 1. Cleanup stale jobs
 * 2. Pick a small batch of pending jobs (default 20)
 * 3. Run a limited number of shops in parallel
 * 4. Return early, ready for next invocation
 */

const BATCH_SIZE = 20; // Max jobs per call
const PARALLEL_LIMIT_ORDERS = 3; // Max shops running at once for orders
const PARALLEL_LIMIT_SKUS = 1; // SKUs MUST run sequentially (1 per shop at a time)
const PARALLEL_LIMIT_REFUNDS = 3; // Refunds can run in parallel

serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  try {
    // === Parse incoming filters ===
    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const objectTypeFilter = body.objectType || null;
    const shopFilter = body.shop || null;

    console.log(
      `🔄 Continue Orchestrator starting...` +
        (objectTypeFilter ? ` Type: ${objectTypeFilter}` : " All types") +
        (shopFilter ? ` | Shop: ${shopFilter}` : "")
    );

    // === Step 1: Cleanup stale running jobs ===
    const staleCount = await cleanupStaleJobs(supabase);
    if (staleCount > 0) console.log(`🧹 Cleaned up ${staleCount} stale jobs`);

    // === Step 2: Get next batch of pending jobs ===
    let query = supabase
      .from("bulk_sync_jobs")
      .select("*")
      .eq("status", "pending")
      .order("start_date", { ascending: true })
      .order("shop", { ascending: true })
      .limit(BATCH_SIZE);

    if (objectTypeFilter) query = query.eq("object_type", objectTypeFilter);
    if (shopFilter) query = query.eq("shop", shopFilter);

    const { data: pendingJobs, error } = await query;
    if (error) throw new Error(`Failed to fetch pending jobs: ${error.message}`);

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log("✅ No pending jobs found — sync complete!");
      const { data: allJobs } = await supabase.from("bulk_sync_jobs").select("status");
      const stats = {
        completed: allJobs?.filter((j) => j.status === "completed").length || 0,
        failed: allJobs?.filter((j) => j.status === "failed").length || 0,
        pending: 0,
      };
      return jsonResponse({ complete: true, message: "All jobs processed!", stats });
    }

    console.log(`📦 Found ${pendingJobs.length} pending jobs to process...`);

    // === Step 3: Determine parallel limit based on object_type ===
    const objectType = pendingJobs[0]?.object_type;
    let PARALLEL_LIMIT = PARALLEL_LIMIT_ORDERS; // default

    if (objectType === "skus") {
      PARALLEL_LIMIT = PARALLEL_LIMIT_SKUS;
      console.log("⚠️ SKU jobs detected - running sequentially (1 shop at a time)");
    } else if (objectType === "refunds") {
      PARALLEL_LIMIT = PARALLEL_LIMIT_REFUNDS;
    }

    // === Step 4: Process jobs grouped by shop (1 job per shop) ===
    const results = [];
    const jobsByShop = pendingJobs.reduce((acc, job) => {
      acc[job.shop] = acc[job.shop] || [];
      acc[job.shop].push(job);
      return acc;
    }, {});

    let activeShops = Object.keys(jobsByShop);
    let batchIndex = 0;

    while (activeShops.length > 0) {
      batchIndex++;
      const shopBatch = activeShops.slice(0, PARALLEL_LIMIT);
      const jobBatch = shopBatch
        .map((shop) => jobsByShop[shop]?.shift())
        .filter(Boolean);

      if (jobBatch.length === 0) {
        console.log("⚠️ No valid jobs in batch — skipping...");
        break;
      }

      console.log(`⚙️ Batch ${batchIndex}: ${jobBatch.length} jobs (${shopBatch.join(", ")})`);

      const promises = jobBatch.map((job) => processJob(supabase, job));
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      // Remove finished shops
      for (const shop of shopBatch) {
        if (!jobsByShop[shop] || jobsByShop[shop].length === 0) delete jobsByShop[shop];
      }

      activeShops = Object.keys(jobsByShop);
      console.log(
        `📦 Batch ${batchIndex} done: ${batchResults.filter((r) => r.success).length}/${batchResults.length} succeeded`
      );

      await new Promise((r) => setTimeout(r, 1000)); // short pause
    }

    // === Step 4: Remaining stats ===
    const { data: allJobs } = await supabase.from("bulk_sync_jobs").select("status");
    const remaining = {
      completed: allJobs?.filter((j) => j.status === "completed").length || 0,
      failed: allJobs?.filter((j) => j.status === "failed").length || 0,
      pending: allJobs?.filter((j) => j.status === "pending").length || 0,
      running: allJobs?.filter((j) => j.status === "running").length || 0,
    };

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `✅ Batch complete: ${results.filter((r) => r.success).length}/${results.length} successful | ⏱ ${duration}s`
    );
    console.log(
      `📊 Remaining — pending: ${remaining.pending}, completed: ${remaining.completed}, failed: ${remaining.failed}`
    );

    return jsonResponse({
      complete: remaining.pending === 0,
      message:
        remaining.pending > 0
          ? `Processed ${results.length} jobs - ${remaining.pending} remaining`
          : "All jobs processed!",
      stats: remaining,
      durationSeconds: duration,
    });
  } catch (error) {
    console.error("❌ Continue orchestrator error:", error);
    return jsonResponse({ error: error.message, timestamp: new Date().toISOString() }, 500);
  }
});

// === UTIL FUNCTIONS ======================================================

async function processJob(supabase, job) {
  try {
    await supabase
      .from("bulk_sync_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    const fnName =
      job.object_type === "refunds"
        ? "batch-sync-refunds"
        : job.object_type === "orders"
        ? "bulk-sync-orders"
        : "bulk-sync-skus";

    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${
          Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
        }`,
        "Content-Type": "application/json",
        "X-Skip-Concurrent-Check": "true", // Tell bulk-sync-skus to skip concurrent check
      },
      body: JSON.stringify({
        shop: job.shop,
        startDate: job.start_date,
        endDate: job.end_date || job.start_date,
        jobId: job.id,
        includeRefunds: job.object_type === "orders" || job.object_type === "refunds",
        searchMode: job.object_type === "refunds" ? "updated_at" : undefined, // refunds use updated_at (refund.created_at)
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      await supabase
        .from("bulk_sync_jobs")
        .update({
          status: "failed",
          error_message: `Edge function failed (${resp.status}) ${errorText.slice(0, 150)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return { shop: job.shop, date: job.start_date, type: job.object_type, success: false };
    }

    const result = await resp.json();

    // Check if batch sync needs more iterations (for refunds)
    const isComplete = result.complete !== false; // Default to true if not specified

    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: isComplete ? "completed" : "pending", // Set to pending if more work needed
        completed_at: isComplete ? new Date().toISOString() : null,
        orders_synced: result.orders_synced || result.orderCount || 0,
        skus_synced: result.skus_synced || result.skuCount || 0,
        records_processed: result.totalProcessed || result.records_processed || 0,
      })
      .eq("id", job.id);

    return { shop: job.shop, date: job.start_date, type: job.object_type, success: true };
  } catch (err) {
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { shop: job.shop, date: job.start_date, type: job.object_type, success: false };
  }
}

async function cleanupStaleJobs(supabase) {
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}