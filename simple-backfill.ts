/**
 * Simple backfill: Update refund_date for cancelled SKUs using their own created_at
 * Run with: deno run --allow-net --allow-env simple-backfill.ts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://ihawjrtfwysyokfotewn.supabase.co";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseKey) {
  console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

console.log("🚀 Starting simple backfill...\n");

// Fetch all cancelled items without refund_date
console.log("📊 Step 1: Fetching cancelled items without refund_date...");
const { data: itemsToUpdate, error: fetchError } = await supabase
  .from("skus")
  .select("id, created_at")
  .gt("cancelled_qty", 0)
  .is("refund_date", null);

if (fetchError) {
  console.error("❌ Fetch error:", fetchError);
  Deno.exit(1);
}

console.log(`✅ Found ${itemsToUpdate?.length || 0} items to update\n`);

if (!itemsToUpdate || itemsToUpdate.length === 0) {
  console.log("✨ No items to update! All cancelled items already have refund_date.");
  Deno.exit(0);
}

// Update in batches of 500
const BATCH_SIZE = 500;
let updated = 0;

for (let i = 0; i < itemsToUpdate.length; i += BATCH_SIZE) {
  const batch = itemsToUpdate.slice(i, i + BATCH_SIZE);

  console.log(`📝 Updating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToUpdate.length / BATCH_SIZE)} (${batch.length} items)...`);

  // Update each item in batch
  for (const item of batch) {
    const { error: updateError } = await supabase
      .from("skus")
      .update({ refund_date: item.created_at })
      .eq("id", item.id);

    if (updateError) {
      console.error(`❌ Error updating item ${item.id}:`, updateError);
    } else {
      updated++;
    }
  }

  console.log(`✅ Batch complete. Total updated: ${updated}/${itemsToUpdate.length}`);
}

console.log(`\n✅ Update complete! Updated ${updated} items.\n`);

// Verify results
console.log("🔍 Verification: Checking cancelled items status...");
const { data: verifyData, error: verifyError } = await supabase
  .from("skus")
  .select("shop, cancelled_qty, refund_date")
  .gt("cancelled_qty", 0)
  .limit(10);

if (verifyError) {
  console.error("❌ Verification error:", verifyError);
} else {
  console.log(`📊 Sample of ${verifyData?.length || 0} cancelled items:`);
  verifyData?.forEach(row => {
    console.log(`  - Shop: ${row.shop}, Cancelled: ${row.cancelled_qty}, Refund Date: ${row.refund_date ? '✅ ' + row.refund_date : '❌ NULL'}`);
  });
}

// Count summary
const { count: totalCancelled, error: countError1 } = await supabase
  .from("skus")
  .select("*", { count: "exact", head: true })
  .gt("cancelled_qty", 0);

const { count: withRefundDate, error: countError2 } = await supabase
  .from("skus")
  .select("*", { count: "exact", head: true })
  .gt("cancelled_qty", 0)
  .not("refund_date", "is", null);

const { count: withoutRefundDate, error: countError3 } = await supabase
  .from("skus")
  .select("*", { count: "exact", head: true })
  .gt("cancelled_qty", 0)
  .is("refund_date", null);

console.log("\n" + "=".repeat(60));
console.log("📊 BACKFILL SUMMARY");
console.log("=".repeat(60));
console.log(`Total cancelled items:       ${totalCancelled || "?"}`);
console.log(`With refund_date:            ${withRefundDate || "?"} ✅`);
console.log(`WITHOUT refund_date:         ${withoutRefundDate || "?"} ${withoutRefundDate === 0 ? '✅' : '❌'}`);
console.log("=".repeat(60));

if (withoutRefundDate === 0) {
  console.log("\n✨ SUCCESS! All cancelled items now have refund_date!");
} else {
  console.log(`\n⚠️  WARNING: Still ${withoutRefundDate} cancelled items without refund_date`);
}
