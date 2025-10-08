/**
 * Backfill script: Update refund_date for cancelled SKUs
 * Run with: deno run --allow-net --allow-env backfill-cancelled-refund-dates.ts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 100;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://ihawjrtfwysyokfotewn.supabase.co";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseKey) {
  console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

console.log("🚀 Starting backfill of refund_date for cancelled SKUs...\n");

// Step 1: Get all cancelled SKUs without refund_date
console.log("📊 Step 1: Finding cancelled SKUs without refund_date...");
const { data: cancelledSkus, error: fetchError } = await supabase
  .from("skus")
  .select("id, shop, order_id, sku, cancelled_qty")
  .gt("cancelled_qty", 0)
  .is("refund_date", null)
  .order("shop, order_id");

if (fetchError) {
  console.error("❌ Error fetching cancelled SKUs:", fetchError);
  Deno.exit(1);
}

console.log(`✅ Found ${cancelledSkus?.length || 0} cancelled SKUs without refund_date\n`);

if (!cancelledSkus || cancelledSkus.length === 0) {
  console.log("✨ No work to do! All cancelled SKUs have refund_date.");
  Deno.exit(0);
}

// Step 2: Group by order to minimize order lookups
const orderMap = new Map<string, string[]>();
for (const sku of cancelledSkus) {
  const key = `${sku.shop}-${sku.order_id}`;
  if (!orderMap.has(key)) {
    orderMap.set(key, []);
  }
  orderMap.get(key)!.push(sku.id);
}

console.log(`📦 Processing ${orderMap.size} unique orders...\n`);

// Step 3: Process in batches
let processedOrders = 0;
let updatedSkus = 0;
let skippedOrders = 0;

const orderKeys = Array.from(orderMap.keys());
for (let i = 0; i < orderKeys.length; i += BATCH_SIZE) {
  const batch = orderKeys.slice(i, i + BATCH_SIZE);

  for (const key of batch) {
    // Key format: "shop.myshopify.com-orderid"
    // Find the last dash which separates shop from order_id
    const lastDashIndex = key.lastIndexOf("-");
    const shop = key.substring(0, lastDashIndex);
    const orderId = key.substring(lastDashIndex + 1);
    const skuIds = orderMap.get(key)!;

    // Get order data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("refund_date, cancelled_at, updated_at")
      .eq("shop", shop)
      .eq("order_id", orderId)
      .single();

    if (orderError || !order) {
      console.warn(`⚠️  Order ${shop}/${orderId} not found in orders table`);
      skippedOrders++;
      continue;
    }

    // Determine refund_date to use (priority: refund_date > cancelled_at > updated_at)
    const refundDate = order.refund_date || order.cancelled_at || order.updated_at;

    if (!refundDate) {
      console.warn(`⚠️  Order ${shop}/${orderId} has no date to use for refund_date`);
      skippedOrders++;
      continue;
    }

    // Update all SKUs for this order
    const { error: updateError } = await supabase
      .from("skus")
      .update({ refund_date: refundDate })
      .in("id", skuIds);

    if (updateError) {
      console.error(`❌ Error updating SKUs for order ${shop}/${orderId}:`, updateError);
    } else {
      updatedSkus += skuIds.length;
      console.log(`✅ Updated ${skuIds.length} SKUs for order ${shop}/${orderId} with refund_date=${refundDate.split("T")[0]}`);
    }

    processedOrders++;
  }

  // Progress update
  console.log(`\n📊 Progress: ${processedOrders}/${orderMap.size} orders processed, ${updatedSkus} SKUs updated\n`);
}

// Step 4: Verify results
console.log("\n🔍 Verification: Checking remaining cancelled SKUs without refund_date...");
const { data: remaining, error: verifyError } = await supabase
  .from("skus")
  .select("shop")
  .gt("cancelled_qty", 0)
  .is("refund_date", null)
  .limit(1);

if (verifyError) {
  console.error("❌ Error verifying results:", verifyError);
} else if (remaining && remaining.length > 0) {
  console.warn(`⚠️  Still ${remaining.length}+ cancelled SKUs without refund_date`);
} else {
  console.log("✅ All cancelled SKUs now have refund_date!");
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("📊 BACKFILL SUMMARY");
console.log("=".repeat(60));
console.log(`Total cancelled SKUs found:  ${cancelledSkus.length}`);
console.log(`Orders processed:            ${processedOrders}`);
console.log(`SKUs updated:                ${updatedSkus}`);
console.log(`Orders skipped:              ${skippedOrders}`);
console.log("=".repeat(60));
console.log("\n✨ Backfill complete!");
