import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const batchSize = parseInt(url.searchParams.get("batchSize") || "500");
    const dryRun = url.searchParams.get("dryRun") === "true";

    console.log(`Starting cleanup with batchSize=${batchSize}, dryRun=${dryRun}`);

    // Find records that need cleanup
    const { data: needsCleanup, error: findError } = await supabase
      .from("skus")
      .select("order_id, sku, cancelled_qty, cancelled_amount_dkk")
      .eq("cancelled_qty", 0)
      .gt("cancelled_amount_dkk", 0)
      .limit(batchSize);

    if (findError) {
      throw new Error(`Find error: ${findError.message}`);
    }

    if (!needsCleanup || needsCleanup.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No records need cleanup",
          recordsFound: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${needsCleanup.length} records that need cleanup`);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          recordsFound: needsCleanup.length,
          sample: needsCleanup.slice(0, 5),
          message: `Would clean up ${needsCleanup.length} records`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Perform cleanup in batch
    const orderSkuPairs = needsCleanup.map(r => ({ order_id: r.order_id, sku: r.sku }));

    let updatedCount = 0;
    for (const pair of orderSkuPairs) {
      const { error: updateError } = await supabase
        .from("skus")
        .update({ cancelled_amount_dkk: 0 })
        .eq("order_id", pair.order_id)
        .eq("sku", pair.sku)
        .eq("cancelled_qty", 0)
        .gt("cancelled_amount_dkk", 0);

      if (updateError) {
        console.error(`Update error for order ${pair.order_id}, sku ${pair.sku}:`, updateError);
      } else {
        updatedCount++;
      }
    }

    console.log(`Successfully updated ${updatedCount}/${needsCleanup.length} records`);

    // Check if more records need cleanup
    const { count: remainingCount } = await supabase
      .from("skus")
      .select("*", { count: "exact", head: true })
      .eq("cancelled_qty", 0)
      .gt("cancelled_amount_dkk", 0);

    return new Response(
      JSON.stringify({
        success: true,
        recordsFound: needsCleanup.length,
        recordsUpdated: updatedCount,
        remainingRecords: remainingCount || 0,
        message: remainingCount && remainingCount > 0
          ? `Cleaned up ${updatedCount} records. ${remainingCount} more records need cleanup - run again.`
          : `Successfully cleaned up all ${updatedCount} records!`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
