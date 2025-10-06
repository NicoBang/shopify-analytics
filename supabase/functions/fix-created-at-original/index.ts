import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Fix incorrect created_at_original values in skus table
 *
 * Problem: Many skus have created_at_original = sync date instead of actual Shopify order date
 * Solution: Update skus.created_at_original from orders.created_at for affected rows
 *
 * Usage:
 * curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/fix-created-at-original" \
 *   -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
 *   -H "Content-Type: application/json" \
 *   -d '{"dryRun": true, "cutoffDate": "2025-10-05"}'
 */

interface FixRequest {
  dryRun?: boolean;
  cutoffDate?: string; // Only fix rows with created_at_original >= this date
  batchSize?: number;
}

serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      dryRun = true,
      cutoffDate = "2025-10-05",
      batchSize = 1000
    }: FixRequest = body;

    console.log(`🔧 Starting created_at_original fix...`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Cutoff date: ${cutoffDate}`);
    console.log(`   Batch size: ${batchSize}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Step 1: Find affected SKUs (created_at_original >= cutoffDate)
    console.log(`\n📊 Finding affected SKUs with created_at_original >= ${cutoffDate}...`);

    const { data: affectedSkus, error: findError } = await supabase
      .from("skus")
      .select("shop, order_id, sku, created_at_original")
      .gte("created_at_original", cutoffDate)
      .order("created_at_original", { ascending: true });

    if (findError) {
      throw new Error(`Failed to find affected SKUs: ${findError.message}`);
    }

    console.log(`✅ Found ${affectedSkus?.length || 0} affected SKUs`);

    if (!affectedSkus || affectedSkus.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No affected SKUs found",
          affectedCount: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 2: Get unique order_ids
    const uniqueOrderIds = [...new Set(affectedSkus.map(sku => sku.order_id))];
    console.log(`📦 Unique orders to update: ${uniqueOrderIds.length}`);

    // Step 3: Fetch correct created_at from orders table
    const orderDatesMap = new Map<string, string>();
    let fetchedOrders = 0;

    // Fetch in batches to avoid query size limits
    for (let i = 0; i < uniqueOrderIds.length; i += batchSize) {
      const orderBatch = uniqueOrderIds.slice(i, i + batchSize);

      const { data: orders, error: orderError } = await supabase
        .from("orders")
        .select("order_id, created_at")
        .in("order_id", orderBatch);

      if (orderError) {
        console.error(`❌ Error fetching orders batch ${i / batchSize + 1}:`, orderError);
        continue;
      }

      if (orders) {
        fetchedOrders += orders.length;
        orders.forEach(order => {
          orderDatesMap.set(order.order_id, order.created_at);
        });
      }

      console.log(`  Batch ${i / batchSize + 1}: Fetched ${orders?.length || 0} orders`);
    }

    console.log(`✅ Fetched ${fetchedOrders} order dates from ${uniqueOrderIds.length} unique orders`);

    // Step 4: Build update records
    const updates: any[] = [];
    let skipped = 0;

    for (const sku of affectedSkus) {
      const correctDate = orderDatesMap.get(sku.order_id);

      if (!correctDate) {
        console.warn(`⚠️ No order date found for order_id=${sku.order_id}, SKU=${sku.sku}`);
        skipped++;
        continue;
      }

      updates.push({
        shop: sku.shop,
        order_id: sku.order_id,
        sku: sku.sku,
        created_at_original: correctDate,
      });
    }

    console.log(`\n📊 Update summary:`);
    console.log(`   Total affected SKUs: ${affectedSkus.length}`);
    console.log(`   SKUs to update: ${updates.length}`);
    console.log(`   SKUs skipped (no order found): ${skipped}`);

    if (dryRun) {
      console.log(`\n🔍 DRY RUN - No changes made to database`);
      console.log(`\n📋 Sample updates (first 5):`);
      updates.slice(0, 5).forEach((update, idx) => {
        console.log(`\n  ${idx + 1}. Order ${update.order_id}, SKU ${update.sku}`);
        console.log(`     New created_at_original: ${update.created_at_original}`);
      });

      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          affectedCount: affectedSkus.length,
          toUpdate: updates.length,
          skipped,
          sampleUpdates: updates.slice(0, 5),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 5: Apply updates in batches
    console.log(`\n💾 Applying updates to database...`);
    let updatedCount = 0;

    for (let i = 0; i < updates.length; i += batchSize) {
      const updateBatch = updates.slice(i, i + batchSize);

      const { error: updateError } = await supabase
        .from("skus")
        .upsert(updateBatch, {
          onConflict: "shop,order_id,sku",
          ignoreDuplicates: false,
        });

      if (updateError) {
        console.error(`❌ Error updating batch ${i / batchSize + 1}:`, updateError);
        throw new Error(`Failed to update SKUs: ${updateError.message}`);
      }

      updatedCount += updateBatch.length;
      console.log(`  Batch ${i / batchSize + 1}: Updated ${updateBatch.length} SKUs (total: ${updatedCount})`);
    }

    console.log(`\n✅ Successfully updated ${updatedCount} SKUs`);

    return new Response(
      JSON.stringify({
        success: true,
        dryRun: false,
        affectedCount: affectedSkus.length,
        updated: updatedCount,
        skipped,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("❌ Function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
