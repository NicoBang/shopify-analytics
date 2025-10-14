import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BATCH_SIZE = 500;

serve(async (req: Request): Promise<Response> => {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const shop = body.shop || "pompdelux-da.myshopify.com";
    const dryRun = body.dryRun === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log(`🔧 Fixing historical discounts for ${shop}`);
    console.log(`   Dry run: ${dryRun}`);

    // Step 1: Determine metadata table based on shop
    let metadataTable = 'product_metadata';
    let defaultVatRate = 1.25; // DKK: 25% VAT

    if (shop === 'pompdelux-chf.myshopify.com') {
      metadataTable = 'product_metadata_chf';
      defaultVatRate = 1.077; // CHF: 7.7% VAT
    } else if (shop !== 'pompdelux-da.myshopify.com') {
      metadataTable = 'product_metadata_eur';
      defaultVatRate = 1.25; // EUR shops use DKK VAT rate
    }

    console.log(`📋 Using metadata table: ${metadataTable}`);

    // Step 2: Get all SKUs for this shop
    const { data: skus, error: fetchError } = await supabase
      .from('skus')
      .select('shop, order_id, sku, price_dkk, total_discount_dkk, quantity, tax_rate')
      .eq('shop', shop);

    if (fetchError) {
      console.error(`❌ Error fetching SKUs:`, fetchError);
      throw fetchError;
    }

    if (!skus || skus.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No SKUs found', updated: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${skus.length} SKUs to fix`);

    // Step 3: Get product_metadata for these SKUs
    const skuList = [...new Set(skus.map(s => s.sku))];
    const { data: metadata, error: metaError } = await supabase
      .from(metadataTable)
      .select('sku, price, compare_at_price')
      .in('sku', skuList);

    if (metaError) {
      console.error(`❌ Error fetching ${metadataTable}:`, metaError);
      throw metaError;
    }

    console.log(`📊 Found ${metadata?.length || 0} products in ${metadataTable}`);

    const metadataMap = new Map(metadata?.map(m => [m.sku, m]) || []);

    // Step 4: Calculate corrections
    const updates: any[] = [];
    let skipped = 0;

    for (const sku of skus) {
      const pm = metadataMap.get(sku.sku);
      if (!pm) {
        skipped++;
        continue;
      }

      // Get actual tax_rate from SKU (fallback to default VAT rate)
      const actualTaxRate = sku.tax_rate;
      const effectiveVatMultiplier = actualTaxRate !== null && actualTaxRate !== undefined
        ? (1 + actualTaxRate)
        : defaultVatRate;

      // Convert from INCL VAT to EX VAT
      const compareAtPriceExVat = (pm.compare_at_price || 0) / effectiveVatMultiplier;
      const priceExVat = (pm.price || 0) / effectiveVatMultiplier;

      // Original price = MAX(compareAt, price) ex VAT
      const originalPriceDkk = Math.max(compareAtPriceExVat, priceExVat);

      // Sale discount = original - actual selling price (both ex VAT)
      const saleDiscountPerUnit = Math.max(originalPriceDkk - sku.price_dkk, 0);
      const saleDiscountTotal = saleDiscountPerUnit * sku.quantity;

      // Order discount = total_discount - sale_discount
      const orderDiscountTotal = Math.max(sku.total_discount_dkk - saleDiscountTotal, 0);
      const orderDiscountPerUnit = orderDiscountTotal / sku.quantity;

      updates.push({
        shop: sku.shop,
        order_id: sku.order_id,
        sku: sku.sku,
        original_price_dkk: originalPriceDkk,
        sale_discount_per_unit_dkk: saleDiscountPerUnit,
        sale_discount_total_dkk: saleDiscountTotal,
        discount_per_unit_dkk: orderDiscountPerUnit,
      });
    }

    console.log(`✅ Prepared ${updates.length} updates (skipped ${skipped} SKUs without metadata)`);

    if (dryRun) {
      console.log(`🔍 DRY RUN - showing first 10 updates:`);
      console.log(JSON.stringify(updates.slice(0, 10), null, 2));
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          totalUpdates: updates.length,
          skipped,
          sample: updates.slice(0, 10),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 5: Batch update SKUs
    let totalUpdated = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      const { error: updateError } = await supabase
        .from('skus')
        .upsert(batch, { onConflict: 'shop,order_id,sku' });

      if (updateError) {
        console.error(`❌ Error updating batch ${i}-${i + batch.length}:`, updateError);
        throw updateError;
      }

      totalUpdated += batch.length;
      console.log(`📝 Updated ${totalUpdated}/${updates.length} SKUs`);
    }

    console.log(`✅ Fixed ${totalUpdated} SKUs (skipped ${skipped})`);

    return new Response(
      JSON.stringify({
        success: true,
        updated: totalUpdated,
        skipped,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
