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

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    if (!serviceKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
      { auth: { persistSession: false } }
    );

    console.log(`🧹 Starting SKU cleanup (dryRun: ${dryRun})...`);

    // Step 1: Find all duplicates using direct SQL query
    const { data: duplicates, error: findError } = await supabase
      .from("skus")
      .select("id, order_id, sku, created_at, refund_date")
      .order("order_id", { ascending: true })
      .order("sku", { ascending: true });

    if (findError) {
      throw new Error(`Failed to find duplicates: ${findError.message}`);
    }

    // Filter duplicates in TypeScript (since we can't use window functions in PostgREST)
    const duplicateGroups = new Map<string, any[]>();

    // Group by order_id + sku
    duplicates?.forEach((row: any) => {
      const key = `${row.order_id}|${row.sku}`;
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key)!.push(row);
    });

    // Find groups with > 1 row (duplicates)
    const duplicateRows: any[] = [];
    duplicateGroups.forEach((rows, key) => {
      if (rows.length > 1) {
        // Sort rows: newest created_at first, prefer rows with refund_date, then highest id
        rows.sort((a, b) => {
          // First: created_at DESC
          if (a.created_at !== b.created_at) {
            return b.created_at > a.created_at ? 1 : -1;
          }
          // Second: refund_date presence (rows with refund_date first)
          const aHasRefund = a.refund_date ? 1 : 0;
          const bHasRefund = b.refund_date ? 1 : 0;
          if (aHasRefund !== bHasRefund) {
            return bHasRefund - aHasRefund;
          }
          // Third: id DESC
          return b.id > a.id ? 1 : -1;
        });

        // Keep first (newest), mark rest as duplicates
        duplicateRows.push(...rows.slice(1));
      }
    });

    if (duplicateRows.length === 0) {
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

    // Count unique groups (order_id + sku combinations) affected by duplicates
    const affectedGroups = new Set(
      duplicateRows.map((d: any) => `${d.order_id}|${d.sku}`)
    );
    const groupsAffected = affectedGroups.size;
    const duplicatesFound = duplicateRows.length;

    console.log(`📊 Found ${duplicatesFound} duplicate SKUs across ${groupsAffected} groups`);

    if (dryRun) {
      console.log("🔍 DRY RUN - No rows will be deleted");
      console.log("Sample duplicates (first 5):");
      duplicateRows.slice(0, 5).forEach((d: any, idx: number) => {
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

    // Step 2: Delete duplicates (keep newest based on created_at DESC, refund_date presence, id DESC)
    console.log("🗑️ Deleting duplicate SKUs...");

    const duplicateIds = duplicateRows.map((d: any) => d.id);

    const { error: deleteError } = await supabase
      .from("skus")
      .delete()
      .in("id", duplicateIds);

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
    const errorMessage = err.message || String(err) || "Unknown cleanup error";
    console.error("💥 Cleanup error:", errorMessage);

    const errorResult: CleanupResult = {
      success: false,
      duplicatesFound: 0,
      rowsDeleted: 0,
      groupsAffected: 0,
      timestamp,
      error: errorMessage,
      message: `Cleanup failed: ${errorMessage}`,
    };

    // Always return 200 with success: false instead of HTTP 500
    // This prevents orchestrator from seeing HTTP errors
    return new Response(JSON.stringify(errorResult), {
      status: 200,
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
