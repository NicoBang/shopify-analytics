import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CleanupRequest {
  dryRun?: boolean;
}

interface CleanupResult {
  success: boolean;
  duplicatesFound: number;
  rowsDeleted: number;
  groupsAffected: number;
  timestamp: string;
  dryRun?: boolean;
  message?: string;
  error?: string;
}

serve(async (req: Request): Promise<Response> => {
  const timestamp = new Date().toISOString();

  try {
    const body = await req.json().catch(() => ({}));
    const { dryRun = false }: CleanupRequest = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log(`🧹 Starting SKU cleanup (dryRun: ${dryRun})...`);

    // Step 1: Find all duplicates
    const { data: duplicates, error: findError } = await supabase.rpc(
      "find_duplicate_skus"
    );

    if (findError) {
      throw new Error(`Failed to find duplicates: ${findError.message}`);
    }

    if (!duplicates || duplicates.length === 0) {
      console.log("✅ No duplicates found");

      const result: CleanupResult = {
        success: true,
        duplicatesFound: 0,
        rowsDeleted: 0,
        groupsAffected: 0,
        timestamp,
        message: "No duplicates found",
      };

      await logCleanup(supabase, result);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Count unique groups (order_id + sku combinations)
    const uniqueGroups = new Set(
      duplicates.map((d: any) => `${d.order_id}|${d.sku}`)
    );
    const groupsAffected = uniqueGroups.size;
    const duplicatesFound = duplicates.length;

    console.log(`📊 Found ${duplicatesFound} duplicate SKUs across ${groupsAffected} groups`);

    if (dryRun) {
      console.log("🔍 DRY RUN - No rows will be deleted");
      console.log("Sample duplicates (first 5):");
      duplicates.slice(0, 5).forEach((d: any, idx: number) => {
        console.log(
          `  ${idx + 1}. Order: ${d.order_id}, SKU: ${d.sku}, ID: ${d.id}`
        );
      });

      const result: CleanupResult = {
        success: true,
        duplicatesFound,
        rowsDeleted: 0,
        groupsAffected,
        timestamp,
        dryRun: true,
        message: `Found ${duplicatesFound} duplicates (no deletion performed)`,
      };

      await logCleanup(supabase, result);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 2: Delete duplicates (keep newest based on created_at DESC, id DESC)
    console.log("🗑️ Deleting duplicate SKUs...");

    const { error: deleteError } = await supabase.rpc("delete_duplicate_skus");

    if (deleteError) {
      throw new Error(`Failed to delete duplicates: ${deleteError.message}`);
    }

    console.log(`✅ Successfully deleted ${duplicatesFound} duplicate SKUs`);

    const result: CleanupResult = {
      success: true,
      duplicatesFound,
      rowsDeleted: duplicatesFound,
      groupsAffected,
      timestamp,
      message: `Deleted ${duplicatesFound} duplicate SKUs across ${groupsAffected} orders`,
    };

    await logCleanup(supabase, result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Cleanup error:", err);

    const errorResult: CleanupResult = {
      success: false,
      duplicatesFound: 0,
      rowsDeleted: 0,
      groupsAffected: 0,
      timestamp,
      error: err.message || "Internal Error",
    };

    return new Response(JSON.stringify(errorResult), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function logCleanup(supabase: any, result: CleanupResult) {
  const { error } = await supabase.from("bulk_sync_jobs").insert({
    shop: "all",
    object_type: "cleanup",
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
    status: result.success ? "completed" : "failed",
    records_processed: result.rowsDeleted,
    error_message: result.message || result.error || null,
    started_at: result.timestamp,
    completed_at: result.timestamp,
  });

  if (error) {
    console.error("⚠️ Failed to log cleanup:", error.message);
  }
}
