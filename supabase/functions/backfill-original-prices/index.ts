import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface BackfillRequest {
  shop?: string;           // Optional: specific shop (default: all EUR/CHF shops)
  startDate?: string;      // Optional: start date YYYY-MM-DD
  endDate?: string;        // Optional: end date YYYY-MM-DD
  batchSize?: number;      // Optional: batch size (default: 1000)
  dryRun?: boolean;        // Optional: test without updating (default: false)
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: BackfillRequest = await req.json().catch(() => ({}));
    const {
      shop,
      startDate,
      endDate,
      batchSize = 1000,
      dryRun = false,
    } = body;

    console.log(`\n🔄 Backfill Original Prices from Metadata`);
    console.log(`   Shop: ${shop || "ALL EUR/CHF shops"}`);
    console.log(`   Date Range: ${startDate || "ALL"} → ${endDate || "ALL"}`);
    console.log(`   Batch Size: ${batchSize}`);
    console.log(`   Dry Run: ${dryRun}`);

    // Determine which shops to process
    const shopsToProcess = shop
      ? [shop]
      : [
          "pompdelux-de.myshopify.com",
          "pompdelux-nl.myshopify.com",
          "pompdelux-int.myshopify.com",
          "pompdelux-chf.myshopify.com",
        ];

    let totalUpdated = 0;
    const results: any[] = [];

    for (const shopName of shopsToProcess) {
      console.log(`\n🏪 Processing ${shopName}...`);

      const result = await backfillShop(
        supabase,
        shopName,
        startDate,
        endDate,
        batchSize,
        dryRun
      );

      results.push(result);
      totalUpdated += result.updated;
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalUpdated,
        dryRun,
        results,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function backfillShop(
  supabase: SupabaseClient,
  shop: string,
  startDate: string | undefined,
  endDate: string | undefined,
  batchSize: number,
  dryRun: boolean
): Promise<{ shop: string; updated: number; skipped: number; errors: number }> {
  // Determine metadata table, default VAT rate, and currency rate based on shop
  let metadataTable: string;
  let defaultVatRate: number;
  let currencyRate: number;

  if (shop === "pompdelux-chf.myshopify.com") {
    metadataTable = "product_metadata_chf";
    defaultVatRate = 1.077; // 7.7% VAT
    currencyRate = 6.84; // CHF → DKK
  } else {
    // pompdelux-de, pompdelux-nl, pompdelux-int
    metadataTable = "product_metadata_eur";
    defaultVatRate = 1.25; // 25% VAT
    currencyRate = 7.46; // EUR → DKK
  }

  console.log(`📋 Using ${metadataTable} with default VAT ${defaultVatRate} and currency rate ${currencyRate}`);

  // Build query for SKUs
  let query = supabase
    .from("skus")
    .select("shop, order_id, sku, price_dkk, quantity, tax_rate, created_at_original")
    .eq("shop", shop);

  // Filter by date range using created_at_original (TIMESTAMPTZ)
  if (startDate && endDate) {
    // Include entire day: >= startDate 00:00:00 AND < (endDate + 1 day) 00:00:00
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];
    query = query
      .gte("created_at_original", `${startDate}T00:00:00Z`)
      .lt("created_at_original", `${nextDayStr}T00:00:00Z`);
  } else if (startDate) {
    query = query.gte("created_at_original", `${startDate}T00:00:00Z`);
  } else if (endDate) {
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];
    query = query.lt("created_at_original", `${nextDayStr}T00:00:00Z`);
  }

  const { data: skus, error: fetchError } = await query;

  if (fetchError) {
    console.error(`❌ Error fetching SKUs:`, fetchError);
    throw fetchError;
  }

  if (!skus || skus.length === 0) {
    console.log(`ℹ️ No SKUs found for ${shop}`);
    return { shop, updated: 0, skipped: 0, errors: 0 };
  }

  console.log(`📊 Found ${skus.length} SKUs to process`);

  // Get unique order IDs to fetch tax_rate
  const orderIds = [...new Set(skus.map((s) => s.order_id))];
  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("order_id, tax_rate")
    .eq("shop", shop)
    .in("order_id", orderIds);

  if (orderError) {
    console.error(`❌ Error fetching orders:`, orderError);
    throw orderError;
  }

  const taxRateMap = new Map(orders?.map((o) => [o.order_id, o.tax_rate]) || []);
  console.log(`📊 Found tax rates for ${taxRateMap.size} orders`);

  // Get product metadata for these SKUs
  const skuList = skus.map((s) => s.sku);
  const { data: metadata, error: metaError } = await supabase
    .from(metadataTable)
    .select("sku, price, compare_at_price")
    .in("sku", skuList);

  if (metaError) {
    console.error(`❌ Error fetching ${metadataTable}:`, metaError);
    throw metaError;
  }

  if (!metadata || metadata.length === 0) {
    console.log(`ℹ️ No metadata found for these SKUs`);
    return { shop, updated: 0, skipped: skus.length, errors: 0 };
  }

  console.log(`📊 Found ${metadata.length} products in ${metadataTable}`);

  // Build metadata map for lookup
  const metadataMap = new Map(metadata.map((m) => [m.sku, m]));

  // Calculate updates
  const updates = skus
    .filter((sku) => metadataMap.has(sku.sku))
    .map((sku: any) => {
      const pm = metadataMap.get(sku.sku)!;

      // Get actual tax_rate from order (use SKU's tax_rate if available, otherwise from order)
      const actualTaxRate = sku.tax_rate ?? taxRateMap.get(sku.order_id);
      const effectiveVatMultiplier =
        actualTaxRate !== null && actualTaxRate !== undefined
          ? 1 + actualTaxRate // Use actual tax rate
          : defaultVatRate; // Fallback to default

      // Convert from INCL VAT to EX VAT
      const compareAtPriceExVat = (pm.compare_at_price || 0) / effectiveVatMultiplier;
      const priceExVat = (pm.price || 0) / effectiveVatMultiplier;

      // Original price = MAX(compareAt, price) in ex VAT, converted to DKK
      const originalPriceDkk = Math.max(compareAtPriceExVat, priceExVat) * currencyRate;

      // Sale discount = original - actual selling price
      const saleDiscountPerUnit = Math.max(originalPriceDkk - sku.price_dkk, 0);
      const saleDiscountTotal = saleDiscountPerUnit * sku.quantity;

      return {
        shop: sku.shop,
        order_id: sku.order_id,
        sku: sku.sku,
        original_price_dkk: originalPriceDkk,
        sale_discount_per_unit_dkk: saleDiscountPerUnit,
        sale_discount_total_dkk: saleDiscountTotal,
      };
    });

  console.log(`📊 Calculated ${updates.length} updates`);

  if (dryRun) {
    console.log(`🧪 DRY RUN - would update ${updates.length} SKUs`);
    console.log(`📋 Sample (first 3):`);
    updates.slice(0, 3).forEach((u) => {
      console.log(`   ${u.sku}: original=${u.original_price_dkk.toFixed(2)}, sale_discount=${u.sale_discount_per_unit_dkk.toFixed(2)}`);
    });
    return { shop, updated: updates.length, skipped: skus.length - updates.length, errors: 0 };
  }

  // Update in batches
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    console.log(`📦 Batch ${Math.floor(i / batchSize) + 1}: updating ${batch.length} SKUs...`);

    // Use individual updates for each SKU (more reliable than bulk upsert)
    let batchErrors = 0;
    for (const sku of batch) {
      const { error: updateError } = await supabase
        .from("skus")
        .update({
          original_price_dkk: sku.original_price_dkk,
          sale_discount_per_unit_dkk: sku.sale_discount_per_unit_dkk,
          sale_discount_total_dkk: sku.sale_discount_total_dkk,
        })
        .eq("shop", sku.shop)
        .eq("order_id", sku.order_id)
        .eq("sku", sku.sku);

      if (updateError) {
        batchErrors++;
      }
    }

    const updateError = batchErrors > 0 ? { message: `${batchErrors} updates failed` } : null;

    if (updateError) {
      console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} error:`, updateError.message);
      errors += batch.length;
    } else {
      updated += batch.length;
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} complete`);
    }
  }

  console.log(`✅ ${shop}: Updated ${updated} SKUs, Skipped ${skus.length - updates.length}, Errors ${errors}`);

  return {
    shop,
    updated,
    skipped: skus.length - updates.length,
    errors,
  };
}
