import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPS = [
  "pompdelux-da.myshopify.com",
  "pompdelux-de.myshopify.com",
  "pompdelux-nl.myshopify.com",
  "pompdelux-int.myshopify.com",
  "pompdelux-chf.myshopify.com",
];

const SYNC_TYPES = ["orders", "skus", "refunds", "both"] as const;
type SyncType = typeof SYNC_TYPES[number];

const BATCH_DAYS = 1; // 1-day batches to avoid Edge Function timeout
const RETRY_DELAY_MS = 60000; // 60 seconds
const MAX_RETRIES = 3;
const MIN_DELAY_MS = 2000; // 2 seconds
const MAX_DELAY_MS = 5000; // 5 seconds

interface OrchestratorRequest {
  startDate: string;
  endDate: string;
  shops?: string[];
  types?: SyncType[];
}

interface JobLog {
  shop: string;
  object_type: SyncType;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  records_processed?: number;
  orders_synced?: number;
  skus_synced?: number;
  error_message?: string;
}

serve(async (req: Request): Promise<Response> => {
  const startedAt = new Date().toISOString();

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.startDate || !body.endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: startDate, endDate" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const {
      startDate,
      endDate,
      shops = SHOPS,
      types = SYNC_TYPES,
    }: OrchestratorRequest = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🚀 Orchestrator starting...");
    console.log(`   Shops: ${shops.join(", ")}`);
    console.log(`   Types: ${types.join(", ")}`);
    console.log(`   Period: ${startDate} to ${endDate}`);

    // Initial cleanup of stale jobs
    const initialCleaned = await cleanupStaleJobs(supabase);
    if (initialCleaned > 0) {
      console.log(`🧹 Initial cleanup: ${initialCleaned} stale running jobs`);
    }

    // Generate daily batches
    const batches = generateDailyBatches(startDate, endDate);
    const totalBatches = batches.length * shops.length * types.length;
    console.log(`📅 Generated ${batches.length} daily batches per shop`);
    console.log(`📊 Total jobs queued: ${totalBatches} (${batches.length} batches × ${shops.length} shops × ${types.length} types)`);

    // Add random delay before starting to spread load
    await randomDelay();

    // Process all shops in parallel with staggered start
    const shopResults = await Promise.allSettled(
      shops.map(async (shop, idx) => {
        // Stagger shop starts by 2-5 seconds each
        await sleep(idx * randomInt(MIN_DELAY_MS, MAX_DELAY_MS));
        return processShop(shop, batches, types, supabase);
      })
    );

    // Aggregate results
    const results = shopResults.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          shop: shops[idx],
          jobs: 0,
          successful: 0,
          failed: 0,
          status: "failed",
          error: result.reason?.message || "Unknown error",
        };
      }
    });

    const totalJobs = results.reduce((sum, r) => sum + r.jobs, 0);
    const totalSuccessful = results.reduce((sum, r) => sum + r.successful, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const successCount = results.filter((r) => r.status === "completed").length;

    const finishedAt = new Date().toISOString();
    const duration = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);

    console.log(`✅ Orchestration complete: ${successCount}/${shops.length} shops successful`);
    console.log(`   Jobs: ${totalSuccessful} successful, ${totalFailed} failed (${totalJobs} total)`);
    console.log(`   Duration: ${duration}s`);

    // Run cleanup after all shops are done
    console.log("\n🧹 Running duplicate cleanup...");
    const cleanupResult = await runCleanup(supabase);

    if (cleanupResult.success) {
      console.log(`✅ Cleanup complete: Deleted ${cleanupResult.rowsDeleted} duplicates across ${cleanupResult.groupsAffected} groups`);
      console.log("\n🧾 All shops synced and cleanup done successfully! 🎉\n");
    } else {
      console.error(`❌ Cleanup failed: ${cleanupResult.error}`);
    }

    return new Response(
      JSON.stringify({
        success: successCount === shops.length && cleanupResult.success,
        message: cleanupResult.success
          ? "All shops synced and cleanup completed successfully"
          : `Shops synced but cleanup failed: ${cleanupResult.error}`,
        cleanup: {
          duplicatesFound: cleanupResult.duplicatesFound,
          rowsDeleted: cleanupResult.rowsDeleted,
          groupsAffected: cleanupResult.groupsAffected,
        },
        results,
        summary: {
          totalShops: shops.length,
          successfulShops: successCount,
          totalBatches: batches.length,
          jobsQueued: totalBatches,
          jobsCompleted: totalSuccessful,
          jobsFailed: totalFailed,
          startedAt,
          finishedAt,
          durationSeconds: duration,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("💥 Orchestrator error:", err);
    return new Response(
      JSON.stringify({
        error: err.message || "Internal Error",
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function generateDailyBatches(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const batches: { start: string; end: string }[] = [];

  let current = new Date(start);
  while (current <= end) {
    const batchEnd = new Date(current);
    batchEnd.setDate(batchEnd.getDate() + BATCH_DAYS - 1);

    if (batchEnd > end) {
      batches.push({
        start: current.toISOString().split("T")[0],
        end: end.toISOString().split("T")[0],
      });
      break;
    } else {
      batches.push({
        start: current.toISOString().split("T")[0],
        end: batchEnd.toISOString().split("T")[0],
      });
      current = new Date(batchEnd);
      current.setDate(current.getDate() + 1);
    }
  }

  return batches;
}

async function cleanupStaleJobs(supabase: any): Promise<number> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: staleJobs } = await supabase
    .from("bulk_sync_jobs")
    .update({
      status: "failed",
      error_message: "Edge Function timeout - job killed by Supabase after ~2 minutes",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", twoMinutesAgo)
    .select();

  return staleJobs?.length || 0;
}

async function processShop(
  shop: string,
  batches: { start: string; end: string }[],
  types: readonly SyncType[],
  supabase: any
) {
  console.log(`🏪 Processing ${shop}...`);
  let jobCount = 0;
  let successCount = 0;
  let failCount = 0;

  // Process batches sequentially for this shop
  for (const batch of batches) {
    for (const type of types) {
      jobCount++;
      const success = await processJob(shop, type, batch.start, batch.end, supabase);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Periodic cleanup of stale jobs every 10 jobs
      if (jobCount % 10 === 0) {
        const cleaned = await cleanupStaleJobs(supabase);
        if (cleaned > 0) {
          console.log(`🧹 Periodic cleanup: ${cleaned} stale jobs marked as failed`);
        }
      }

      // Small delay between jobs to avoid rate limits
      await randomDelay();
    }
  }

  await logShopCompletion(shop, jobCount, successCount, failCount, supabase);

  const shopStatus = failCount > 0 ? "failed" : "completed";
  const statusEmoji = failCount > 0 ? "❌" : "✅";
  console.log(`${statusEmoji} [${shop}] ${shopStatus}: ${successCount}/${jobCount} jobs successful, ${failCount} failed`);

  return {
    shop,
    jobs: jobCount,
    successful: successCount,
    failed: failCount,
    status: shopStatus,
  };
}

async function processJob(
  shop: string,
  type: SyncType,
  startDate: string,
  endDate: string,
  supabase: any
): Promise<boolean> {
  // Handle "both" type by calling orders and skus sequentially
  if (type === "both") {
    const ordersSuccess = await processJob(shop, "orders", startDate, endDate, supabase);
    const skusSuccess = await processJob(shop, "skus", startDate, endDate, supabase);
    return ordersSuccess && skusSuccess;
  }

  // Check if job already completed (EXACT type match only)
  // Don't accept "both" as completed for specific "orders" or "skus" types
  const { data: existingJob } = await supabase
    .from("bulk_sync_jobs")
    .select("id, status, records_processed, object_type")
    .eq("shop", shop)
    .eq("object_type", type)  // EXACT match - no "both" fallback
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJob) {
    console.log(`⏭️ [${shop}] ${type} ${startDate} already completed (${existingJob.records_processed} records), skipping`);
    return true;
  }

  // Create pending job log
  const { data: jobData, error: insertError } = await supabase
    .from("bulk_sync_jobs")
    .insert({
      shop,
      object_type: type,
      start_date: startDate,
      end_date: endDate,
      status: "pending",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error(`⚠️ Failed to create job log: ${insertError.message}`);
  }

  const jobId = jobData?.id;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      console.log(`🔄 [${shop}] ${type} ${startDate} to ${endDate} (attempt ${attempt + 1}/${MAX_RETRIES})`);

      // Update to running
      if (jobId) {
        await updateJobStatus(supabase, jobId, "running");
      }

      const result = await callSyncFunction(shop, type, startDate, endDate);

      // Extract counts from result
      const recordsProcessed = result?.results?.reduce((sum: number, r: any) =>
        sum + (r.skusProcessed || r.ordersProcessed || r.refundsProcessed || 0), 0) || 0;

      // Update to completed
      if (jobId) {
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "completed",
            records_processed: recordsProcessed,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }

      console.log(`✅ [${shop}] ${type} ${startDate} to ${endDate} completed (${recordsProcessed} records)`);
      return true;
    } catch (err: any) {
      const errorMessage = err.message || String(err);

      // Check for rate limit (429)
      if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
        console.warn(`⏸️ [${shop}] Rate limited, stopping job processing`);
        if (jobId) {
          await supabase
            .from("bulk_sync_jobs")
            .update({
              status: "failed",
              error_message: "Rate limit exceeded - orchestrator stopped",
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
        throw new Error("RATE_LIMIT_EXCEEDED"); // Propagate to stop shop processing
      }

      // Check for "bulk job already in progress" error
      if (errorMessage.includes("already in progress")) {
        console.warn(`⏳ [${shop}] Bulk job in progress, waiting ${RETRY_DELAY_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(RETRY_DELAY_MS);
        attempt++;
        continue;
      }

      // Other errors: log and fail
      console.error(`❌ [${shop}] ${type} ${startDate} to ${endDate} failed:`, errorMessage);
      if (jobId) {
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "failed",
            error_message: errorMessage.substring(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
      return false;
    }
  }

  // Max retries exceeded
  console.error(`❌ [${shop}] ${type} ${startDate} to ${endDate} failed after ${MAX_RETRIES} retries`);
  if (jobId) {
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        error_message: `Max retries (${MAX_RETRIES}) exceeded`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
  return false;
}

async function callSyncFunction(
  shop: string,
  type: SyncType,
  startDate: string,
  endDate: string
): Promise<any> {
  const functionMap: Record<SyncType, string> = {
    orders: "bulk-sync-orders",
    skus: "bulk-sync-skus",
    refunds: "bulk-sync-refunds",
  };

  const functionName = functionMap[type];
  const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${functionName}`;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log(`🔑 Calling ${functionName} with key prefix: ${serviceRoleKey?.substring(0, 20)}...`);

  // Add timeout to prevent hanging forever (Edge Functions have ~6-7 min hard limit)
  const FUNCTION_TIMEOUT_MS = 360000; // 6 minutes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS);

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop,
        startDate,
        endDate,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    return JSON.parse(responseText);
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError") {
      throw new Error(`Function timeout after ${FUNCTION_TIMEOUT_MS}ms - Edge Function likely killed by Supabase`);
    }

    throw err;
  }
}

async function updateJobStatus(supabase: any, jobId: string, status: string) {
  await supabase
    .from("bulk_sync_jobs")
    .update({ status })
    .eq("id", jobId);
}

async function logShopCompletion(
  shop: string,
  totalJobs: number,
  successCount: number,
  failCount: number,
  supabase: any
) {
  const { error } = await supabase.from("bulk_sync_jobs").insert({
    shop,
    object_type: "summary",
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
    status: "completed",
    records_processed: totalJobs,
    orders_synced: successCount,
    skus_synced: failCount,
    error_message: `Total: ${totalJobs}, Success: ${successCount}, Failed: ${failCount}`,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  if (error) {
    console.error("⚠️ Failed to log shop completion:", error.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(): Promise<void> {
  return sleep(randomInt(MIN_DELAY_MS, MAX_DELAY_MS));
}

async function runCleanup(supabase: any) {
  const timestamp = new Date().toISOString();

  try {
    const cleanupResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/cleanup-duplicate-skus`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          "Content-Type": "application/json",
        },
      }
    );

    const cleanupResult = await cleanupResponse.json();

    // Log cleanup to bulk_sync_jobs
    await supabase.from("bulk_sync_jobs").insert({
      shop: "all",
      object_type: "cleanup",
      start_date: timestamp.split("T")[0],
      end_date: timestamp.split("T")[0],
      status: cleanupResult.success ? "completed" : "failed",
      records_processed: cleanupResult.rowsDeleted || 0,
      error_message: cleanupResult.error || cleanupResult.message,
      started_at: timestamp,
      completed_at: new Date().toISOString(),
    });

    return cleanupResult;
  } catch (err: any) {
    console.error("💥 Cleanup call failed:", err);

    // Log cleanup failure
    await supabase.from("bulk_sync_jobs").insert({
      shop: "all",
      object_type: "cleanup",
      start_date: timestamp.split("T")[0],
      end_date: timestamp.split("T")[0],
      status: "failed",
      error_message: err.message || "Unknown error",
      started_at: timestamp,
      completed_at: new Date().toISOString(),
    });

    return {
      success: false,
      duplicatesFound: 0,
      rowsDeleted: 0,
      groupsAffected: 0,
      error: err.message || "Unknown error",
    };
  }
}
