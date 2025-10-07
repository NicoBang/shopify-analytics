import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Create Missing Jobs
 *
 * Purpose: Incrementally create missing jobs in bulk_sync_jobs table
 * Design: Stateless - can be called repeatedly to fill gaps
 *
 * Strategy:
 * 1. Calculate expected jobs for date range
 * 2. Find which jobs already exist
 * 3. Create batch of missing jobs (100 at a time)
 * 4. Return early with progress status
 * 5. Can be called again to continue
 *
 * This avoids Edge Function timeout by doing incremental work.
 */

const BATCH_SIZE = 100; // Create 100 jobs per invocation
const SHOPS = [
  "pompdelux-da.myshopify.com",
  "pompdelux-de.myshopify.com",
  "pompdelux-nl.myshopify.com",
  "pompdelux-int.myshopify.com",
  "pompdelux-chf.myshopify.com",
];

serve(async (req: Request): Promise<Response> => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const { startDate, endDate } = body;

    if (!startDate || !endDate) {
      throw new Error("startDate and endDate are required");
    }

    console.log(`📋 Creating missing jobs for ${startDate} → ${endDate}`);

    // Generate list of all expected jobs
    const expectedJobs = generateExpectedJobs(startDate, endDate);
    console.log(`   Expected: ${expectedJobs.length} total jobs`);

    // Get existing jobs
    const { data: existingJobs, error: fetchError } = await supabase
      .from("bulk_sync_jobs")
      .select("shop, start_date, object_type")
      .gte("start_date", startDate)
      .lte("start_date", endDate);

    if (fetchError) {
      throw new Error(`Failed to fetch existing jobs: ${fetchError.message}`);
    }

    // Find missing jobs
    const existingSet = new Set(
      existingJobs?.map((j) => `${j.shop}|${j.start_date}|${j.object_type}`) || []
    );

    const missingJobs = expectedJobs.filter(
      (job) => !existingSet.has(`${job.shop}|${job.start_date}|${job.object_type}`)
    );

    console.log(`   Existing: ${existingJobs?.length || 0} jobs`);
    console.log(`   Missing: ${missingJobs.length} jobs`);

    if (missingJobs.length === 0) {
      return new Response(
        JSON.stringify({
          complete: true,
          message: "All jobs already created!",
          stats: {
            expected: expectedJobs.length,
            existing: existingJobs?.length || 0,
            created: 0,
            remaining: 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create batch of missing jobs
    const batchToCreate = missingJobs.slice(0, BATCH_SIZE);
    console.log(`   Creating batch of ${batchToCreate.length} jobs...`);

    const { error: insertError } = await supabase
      .from("bulk_sync_jobs")
      .insert(batchToCreate);

    if (insertError) {
      throw new Error(`Failed to insert jobs: ${insertError.message}`);
    }

    const remaining = missingJobs.length - batchToCreate.length;

    console.log(`✅ Created ${batchToCreate.length} jobs`);
    console.log(`📊 Remaining: ${remaining} jobs`);

    return new Response(
      JSON.stringify({
        complete: remaining === 0,
        message: remaining > 0
          ? `Created ${batchToCreate.length} jobs - ${remaining} remaining`
          : "All missing jobs created!",
        stats: {
          expected: expectedJobs.length,
          existing: existingJobs?.length || 0,
          created: batchToCreate.length,
          remaining,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Error creating jobs:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function generateExpectedJobs(startDate: string, endDate: string): any[] {
  const jobs: any[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Generate daily jobs for each shop
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];

    for (const shop of SHOPS) {
      // Orders job
      jobs.push({
        shop,
        start_date: dateStr,
        end_date: dateStr,
        object_type: "orders",
        status: "pending",
        created_at: new Date().toISOString(),
      });

      // SKUs job
      jobs.push({
        shop,
        start_date: dateStr,
        end_date: dateStr,
        object_type: "skus",
        status: "pending",
        created_at: new Date().toISOString(),
      });
    }
  }

  return jobs;
}
