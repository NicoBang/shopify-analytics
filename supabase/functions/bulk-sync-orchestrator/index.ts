import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPS = [
  "pompdelux-da.myshopify.com",
  "pompdelux-de.myshopify.com",
  "pompdelux-nl.myshopify.com",
  "pompdelux-int.myshopify.com",
  "pompdelux-chf.myshopify.com",
];

const SYNC_TYPES = ["orders", "skus", "refunds"] as const;
type SyncType = typeof SYNC_TYPES[number];

const BATCH_DAYS = 7;
const RETRY_DELAY_MS = 60000; // 60 seconds
const MAX_RETRIES = 3;

interface OrchestratorRequest {
  startDate: string;
  endDate: string;
  shops?: string[];
  types?: SyncType[];
}

interface JobLog {
  shop: string;
  type: SyncType;
  start_date: string;
  end_date: string;
  status: "started" | "completed" | "failed" | "retrying";
  message?: string;
}

serve(async (req: Request): Promise<Response> => {
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🚀 Orchestrator starting...");
    console.log(`   Shops: ${shops.join(", ")}`);
    console.log(`   Types: ${types.join(", ")}`);
    console.log(`   Period: ${startDate} to ${endDate}`);

    // Generate weekly batches
    const batches = generateWeeklyBatches(startDate, endDate);
    console.log(`📅 Generated ${batches.length} weekly batches`);

    // Process all shops in parallel
    const shopResults = await Promise.allSettled(
      shops.map((shop) =>
        processShop(shop, batches, types, supabase)
      )
    );

    // Aggregate results
    const results = shopResults.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          shop: shops[idx],
          jobs: 0,
          status: "failed",
          error: result.reason?.message || "Unknown error",
        };
      }
    });

    const totalJobs = results.reduce((sum, r) => sum + r.jobs, 0);
    const successCount = results.filter((r) => r.status === "completed").length;

    console.log(`✅ Orchestration complete: ${successCount}/${shops.length} shops successful, ${totalJobs} total jobs`);

    return new Response(
      JSON.stringify({
        success: successCount === shops.length,
        results,
        summary: {
          totalShops: shops.length,
          successfulShops: successCount,
          totalJobs,
          batches: batches.length,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("💥 Orchestrator error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function generateWeeklyBatches(startDate: string, endDate: string) {
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

async function processShop(
  shop: string,
  batches: { start: string; end: string }[],
  types: readonly SyncType[],
  supabase: any
) {
  console.log(`🏪 Processing ${shop}...`);
  let jobCount = 0;

  // Process batches sequentially for this shop
  for (const batch of batches) {
    for (const type of types) {
      const success = await processJob(shop, type, batch.start, batch.end, supabase);
      if (success) jobCount++;
    }
  }

  await logShopCompletion(shop, jobCount, supabase);

  return {
    shop,
    jobs: jobCount,
    status: "completed" as const,
  };
}

async function processJob(
  shop: string,
  type: SyncType,
  startDate: string,
  endDate: string,
  supabase: any
): Promise<boolean> {
  const jobLog: JobLog = {
    shop,
    type,
    start_date: startDate,
    end_date: endDate,
    status: "started",
  };

  await logJob(supabase, jobLog);

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      console.log(`🔄 [${shop}] ${type} ${startDate}-${endDate} (attempt ${attempt + 1}/${MAX_RETRIES})`);

      const result = await callSyncFunction(shop, type, startDate, endDate);

      jobLog.status = "completed";
      jobLog.message = `Success: ${JSON.stringify(result)}`;
      await logJob(supabase, jobLog);

      console.log(`✅ [${shop}] ${type} ${startDate}-${endDate} completed`);
      return true;
    } catch (err: any) {
      const errorMessage = err.message || String(err);

      // Check for "bulk job already in progress" error
      if (errorMessage.includes("already in progress")) {
        console.warn(`⏳ [${shop}] Bulk job in progress, waiting ${RETRY_DELAY_MS}ms...`);
        jobLog.status = "retrying";
        jobLog.message = `Retry ${attempt + 1}: Bulk job in progress`;
        await logJob(supabase, jobLog);

        await sleep(RETRY_DELAY_MS);
        attempt++;
        continue;
      }

      // Other errors: fail immediately
      console.error(`❌ [${shop}] ${type} ${startDate}-${endDate} failed:`, errorMessage);
      jobLog.status = "failed";
      jobLog.message = errorMessage;
      await logJob(supabase, jobLog);
      return false;
    }
  }

  // Max retries exceeded
  console.error(`❌ [${shop}] ${type} ${startDate}-${endDate} failed after ${MAX_RETRIES} retries`);
  jobLog.status = "failed";
  jobLog.message = `Max retries (${MAX_RETRIES}) exceeded`;
  await logJob(supabase, jobLog);
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }

  return JSON.parse(responseText);
}

async function logJob(supabase: any, log: JobLog) {
  const { error } = await supabase.from("bulk_job_logs").insert({
    shop: log.shop,
    type: log.type,
    start_date: log.start_date,
    end_date: log.end_date,
    status: log.status,
    message: log.message,
  });

  if (error) {
    console.error("⚠️ Failed to log job:", error.message);
  }
}

async function logShopCompletion(shop: string, jobCount: number, supabase: any) {
  const { error } = await supabase.from("bulk_job_logs").insert({
    shop,
    type: "summary",
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
    status: "completed",
    message: `All jobs completed: ${jobCount} successful jobs`,
  });

  if (error) {
    console.error("⚠️ Failed to log shop completion:", error.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
