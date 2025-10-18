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
 *
 * Updated: 2025-10-15 - Optimized SKU processing (1 job per shop in parallel)
 */

const BATCH_SIZE = 20; // Max jobs per call
const PARALLEL_LIMIT_ORDERS = 3; // Max shops running at once for orders
const PARALLEL_LIMIT_REFUNDS = 3; // Refunds can run in parallel
// SKUs: 1 job per shop (all shops in parallel for max throughput)

// === Dependency System ===
const SYNC_DEPENDENCIES: Record<string, string[]> = {
  "orders": [],
  "skus": ["orders"],
  "refunds": ["orders", "skus"],
  "shipping-discounts": ["orders"],
};

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
    // Sort by dependency order: orders first, then skus, then refunds/shipping-discounts
    const typeOrder = { "orders": 1, "skus": 2, "refunds": 3, "shipping-discounts": 3 };

    let query = supabase
      .from("bulk_sync_jobs")
      .select("*")
      .eq("status", "pending")
      .order("start_date", { ascending: true })
      .order("shop", { ascending: true })
      .limit(BATCH_SIZE);

    if (objectTypeFilter) query = query.eq("object_type", objectTypeFilter);
    if (shopFilter) query = query.eq("shop", shopFilter);

    const { data: rawJobs, error } = await query;
    if (error) throw new Error(`Failed to fetch pending jobs: ${error.message}`);

    // Sort by dependency order (orders → skus → refunds/shipping-discounts)
    const pendingJobs = rawJobs?.sort((a, b) => {
      const orderA = typeOrder[a.object_type as keyof typeof typeOrder] || 999;
      const orderB = typeOrder[b.object_type as keyof typeof typeOrder] || 999;
      return orderA - orderB;
    });

    console.log(`📦 Query returned ${pendingJobs?.length || 0} pending jobs (sorted by dependency order)`);
    if (pendingJobs && pendingJobs.length > 0) {
      console.log(`   First job: ${pendingJobs[0].shop} - ${pendingJobs[0].start_date} (${pendingJobs[0].object_type})`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log("✅ No pending jobs found — sync complete!");
      // Use aggregation to count all jobs (not limited to 1000)
      const { count: completedCount } = await supabase
        .from("bulk_sync_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed");
      const { count: failedCount } = await supabase
        .from("bulk_sync_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed");

      const stats = {
        completed: completedCount || 0,
        failed: failedCount || 0,
        pending: 0,
        running: 0,
      };
      return jsonResponse({ complete: true, message: "All jobs processed!", stats });
    }

    console.log(`📦 Processing ${pendingJobs.length} pending jobs...`);

    // === Step 3: Determine parallel limit based on object_type ===
    const objectType = pendingJobs[0]?.object_type;
    let PARALLEL_LIMIT = PARALLEL_LIMIT_ORDERS; // default

    if (objectType === "skus") {
      console.log("⚡ SKU jobs detected - running 1 job per shop in parallel (max 5 concurrent)");
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

      // ✅ FIX: For SKUs, always take ALL active shops (1 job per shop in parallel)
      const shopBatch = objectType === "skus"
        ? activeShops.slice(0, activeShops.length)  // All shops in parallel
        : activeShops.slice(0, PARALLEL_LIMIT);     // Limited shops for orders/refunds

      const jobBatch = shopBatch
        .map((shop) => jobsByShop[shop]?.shift())
        .filter(Boolean);

      if (jobBatch.length === 0) {
        console.log("⚠️ No valid jobs in batch — skipping...");
        break;
      }

      console.log(`⚙️ Batch ${batchIndex}: ${jobBatch.length} jobs (${shopBatch.join(", ")})`);
      console.log(`🧠 jobBatch IDs: ${jobBatch.map(j => j.id).join(", ")}`);

      // ✅ All jobs run in parallel (different shops = safe, per-shop locking in bulk-sync-skus)
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
    // Use aggregation to count all jobs (not limited to 1000)
    const { count: completedCount } = await supabase
      .from("bulk_sync_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed");
    const { count: failedCount } = await supabase
      .from("bulk_sync_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed");
    const { count: pendingCount } = await supabase
      .from("bulk_sync_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    const { count: runningCount } = await supabase
      .from("bulk_sync_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "running");

    const remaining = {
      completed: completedCount || 0,
      failed: failedCount || 0,
      pending: pendingCount || 0,
      running: runningCount || 0,
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
    // === Step 1: Check dependencies ===
    const dependencies = SYNC_DEPENDENCIES[job.object_type] || [];
    if (dependencies.length > 0) {
      console.log(`🔍 Checking dependencies for ${job.object_type}: ${dependencies.join(", ")}`);

      for (const depType of dependencies) {
        const { data: depJobs } = await supabase
          .from("bulk_sync_jobs")
          .select("status")
          .eq("shop", job.shop)
          .eq("start_date", job.start_date)
          .eq("object_type", depType)
          .single();

        if (!depJobs || depJobs.status !== "completed") {
          console.log(`⏳ Dependency not met: ${depType} (status: ${depJobs?.status || "missing"})`);
          return {
            shop: job.shop,
            date: job.start_date,
            type: job.object_type,
            success: false,
            skipped: true,
            reason: `Waiting for ${depType} to complete`
          };
        }
      }

      console.log(`✅ All dependencies met for ${job.object_type}`);
    }

    // === Step 2: Atomic claim: only update if status is still 'pending' ===
    const { data: claimed, error: claimError } = await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");

    // If claim failed or no rows updated, another orchestrator already took this job
    if (claimError || !claimed || claimed.length === 0) {
      console.log(`⚠️ Job ${job.id} already claimed or not pending - skipping`);
      return { shop: job.shop, date: job.start_date, type: job.object_type, success: false, skipped: true };
    }

    const fnName =
      job.object_type === "refunds"
        ? "batch-sync-refunds"
        : job.object_type === "orders"
        ? "bulk-sync-orders"
        : job.object_type === "shipping-discounts"
        ? "bulk-sync-shipping-discounts"
        : "bulk-sync-skus";

    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${
          Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
        }`,
        "Content-Type": "application/json",
        // ✅ REMOVED: Let bulk-sync-skus handle per-shop concurrent check
        // Only skip for orders/refunds which can run multiple shops in parallel
        ...(job.object_type !== "skus" && { "X-Skip-Concurrent-Check": "true" }),
      },
      body: JSON.stringify({
        shop: job.shop,
        startDate: job.start_date,
        endDate: job.end_date || job.start_date,
        objectType: job.object_type,
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