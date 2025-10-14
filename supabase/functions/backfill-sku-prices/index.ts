import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  shop?: string;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json().catch(() => ({}));
    const { shop, startDate, endDate, dryRun = false } = body;

    console.log(`🔧 Backfilling SKU prices (EX moms correction)...`);
    console.log(`  Shop: ${shop || "all"}`);
    console.log(`  Date range: ${startDate || "all"} to ${endDate || "all"}`);
    console.log(`  Dry run: ${dryRun}`);

    // Build query - use count to get total first
    let countQuery = supabase
      .from("skus")
      .select("*", { count: "exact", head: true });

    if (shop) {
      countQuery = countQuery.eq("shop", shop);
    }
    if (startDate) {
      countQuery = countQuery.gte("created_at_original", startDate);
    }
    if (endDate) {
      countQuery = countQuery.lte("created_at_original", endDate);
    }
    countQuery = countQuery.not("tax_rate", "is", null);

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error("❌ Error counting SKUs:", countError);
      return new Response(
        JSON.stringify({ error: "Failed to count SKUs", details: countError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Total SKUs matching criteria: ${totalCount}`);

    // Fetch all SKUs in batches
    const FETCH_BATCH_SIZE = 1000;
    const skus: any[] = [];

    for (let offset = 0; offset < totalCount!; offset += FETCH_BATCH_SIZE) {
      let query = supabase
        .from("skus")
        .select("shop, order_id, sku, price_dkk, tax_rate, quantity")
        .range(offset, offset + FETCH_BATCH_SIZE - 1);

      if (shop) {
        query = query.eq("shop", shop);
      }
      if (startDate) {
        query = query.gte("created_at_original", startDate);
      }
      if (endDate) {
        query = query.lte("created_at_original", endDate);
      }
      query = query.not("tax_rate", "is", null);

      const { data: batch, error: batchError } = await query;

      if (batchError) {
        console.error(`❌ Error fetching SKUs batch at offset ${offset}:`, batchError);
        continue;
      }

      if (batch) {
        skus.push(...batch);
        console.log(`  Fetched ${skus.length} / ${totalCount} SKUs`);
      }
    }

    const skusError = null; // No error if we got here

    if (skusError) {
      console.error("❌ Error fetching SKUs:", skusError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch SKUs", details: skusError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!skus || skus.length === 0) {
      console.log("✅ No SKUs found matching criteria");
      return new Response(
        JSON.stringify({ message: "No SKUs found", count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${skus.length} SKUs to process`);

    // Find SKUs where price appears to be INCL moms
    // Heuristic: If price * 1.25 results in a round number (or close to it),
    // it's likely INCL moms and needs correction
    const skusToFix = skus.filter((sku) => {
      if (!sku.price_dkk || !sku.tax_rate) return false;

      // Current price
      const currentPrice = sku.price_dkk;

      // Calculate what the EX moms price should be
      const correctedPrice = currentPrice / (1 + sku.tax_rate);

      // If difference is significant (>1%), it needs correction
      const difference = Math.abs(currentPrice - correctedPrice);
      const percentDiff = (difference / currentPrice) * 100;

      return percentDiff > 1; // More than 1% difference suggests INCL moms
    });

    console.log(`🔧 Found ${skusToFix.length} SKUs that need price correction`);

    if (dryRun) {
      // Show sample of what would be fixed
      const sample = skusToFix.slice(0, 10);
      console.log("\n📋 Sample of SKUs that would be corrected:");
      for (const sku of sample) {
        const corrected = sku.price_dkk / (1 + sku.tax_rate);
        console.log(`  Order ${sku.order_id}, SKU ${sku.sku}:`);
        console.log(`    Current:   ${sku.price_dkk.toFixed(2)} DKK (appears INCL moms)`);
        console.log(`    Corrected: ${corrected.toFixed(2)} DKK (EX moms)`);
        console.log(`    Tax rate:  ${sku.tax_rate} (${sku.tax_rate * 100}%)`);
      }

      return new Response(
        JSON.stringify({
          message: "Dry run completed",
          totalSkus: skus.length,
          skusNeedingCorrection: skusToFix.length,
          sample: sample.map((s) => ({
            order_id: s.order_id,
            sku: s.sku,
            current_price: s.price_dkk,
            corrected_price: (s.price_dkk / (1 + s.tax_rate)).toFixed(2),
            tax_rate: s.tax_rate,
          })),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Apply corrections
    const updates = skusToFix.map((sku) => ({
      shop: sku.shop,
      order_id: sku.order_id,
      sku: sku.sku,
      price_dkk: sku.price_dkk / (1 + sku.tax_rate), // Convert INCL to EX moms
    }));

    console.log(`💾 Updating ${updates.length} SKUs...`);

    // Update in batches of 100
    const BATCH_SIZE = 100;
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      for (const update of batch) {
        const { error: updateError } = await supabase
          .from("skus")
          .update({ price_dkk: update.price_dkk })
          .eq("shop", update.shop)
          .eq("order_id", update.order_id)
          .eq("sku", update.sku);

        if (updateError) {
          console.error(`❌ Error updating SKU ${update.sku}:`, updateError);
          errorCount++;
        } else {
          updatedCount++;
        }
      }

      console.log(`  Progress: ${updatedCount} / ${updates.length} updated`);
    }

    console.log(`✅ Backfill completed: ${updatedCount} SKUs updated, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        message: "Backfill completed",
        totalSkus: skus.length,
        skusNeedingCorrection: skusToFix.length,
        updatedCount,
        errorCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Backfill error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
