import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default tax rates by country (matching bulk-sync-orders logic)
function getDefaultTaxRateByCountry(countryCode: string | null): number {
  if (!countryCode) return 0.25; // Default to Danish VAT if no country

  const taxRates: { [key: string]: number } = {
    'DK': 0.25, // Denmark - 25%
    'DE': 0.19, // Germany - 19%
    'NL': 0.21, // Netherlands - 21%
    'CH': 0.077, // Switzerland - 7.7%
    'SE': 0.25, // Sweden - 25%
    'NO': 0.25, // Norway - 25%
    'AT': 0.20, // Austria - 20%
    'BE': 0.21, // Belgium - 21%
    'FI': 0.24, // Finland - 24%
    'FR': 0.20, // France - 20%
    'IT': 0.22, // Italy - 22%
    'ES': 0.21, // Spain - 21%
    'PL': 0.23, // Poland - 23%
  };

  return taxRates[countryCode] || 0.25; // Default to 25% if country not in list
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("🔧 Backfilling tax_rate for orders with NULL tax_rate...");

    // Get all orders with NULL tax_rate
    const { data: orders, error: fetchError } = await supabase
      .from("orders")
      .select("shop, order_id, country")
      .is("tax_rate", null);

    if (fetchError) {
      console.error("❌ Error fetching orders:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch orders", details: fetchError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!orders || orders.length === 0) {
      console.log("✅ No orders with NULL tax_rate found");
      return new Response(
        JSON.stringify({ message: "No orders to backfill", count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${orders.length} orders with NULL tax_rate`);

    // Update each order with country-based tax_rate
    let updatedCount = 0;
    let errorCount = 0;

    for (const order of orders) {
      const taxRate = getDefaultTaxRateByCountry(order.country);

      const { error: updateError } = await supabase
        .from("orders")
        .update({ tax_rate: taxRate })
        .eq("shop", order.shop)
        .eq("order_id", order.order_id);

      if (updateError) {
        console.error(`❌ Error updating order ${order.order_id}:`, updateError);
        errorCount++;
      } else {
        updatedCount++;
        if (updatedCount % 50 === 0) {
          console.log(`  Progress: ${updatedCount} / ${orders.length} updated`);
        }
      }
    }

    console.log(`✅ Backfill completed: ${updatedCount} orders updated, ${errorCount} errors`);

    // Now update affected SKUs
    console.log("\n🔧 Updating affected SKUs...");

    const { data: skus, error: skuFetchError } = await supabase
      .from("skus")
      .select("shop, order_id, sku")
      .is("tax_rate", null);

    if (skuFetchError) {
      console.error("❌ Error fetching SKUs:", skuFetchError);
    } else if (skus && skus.length > 0) {
      console.log(`📊 Found ${skus.length} SKUs with NULL tax_rate`);

      // Get tax_rate from parent orders
      const orderIds = [...new Set(skus.map(s => s.order_id))];
      const { data: ordersWithTaxRate, error: ordersTaxError } = await supabase
        .from("orders")
        .select("order_id, tax_rate, shop")
        .in("order_id", orderIds);

      if (ordersTaxError) {
        console.error("❌ Error fetching order tax rates:", ordersTaxError);
      } else if (ordersWithTaxRate) {
        const taxRateMap = new Map<string, number>();
        for (const ord of ordersWithTaxRate) {
          if (ord.tax_rate !== null) {
            taxRateMap.set(`${ord.shop}:${ord.order_id}`, ord.tax_rate);
          }
        }

        let skuUpdatedCount = 0;
        let skuErrorCount = 0;

        for (const sku of skus) {
          const key = `${sku.shop}:${sku.order_id}`;
          const taxRate = taxRateMap.get(key);

          if (taxRate !== undefined) {
            const { error: skuUpdateError } = await supabase
              .from("skus")
              .update({ tax_rate: taxRate })
              .eq("shop", sku.shop)
              .eq("order_id", sku.order_id)
              .eq("sku", sku.sku);

            if (skuUpdateError) {
              console.error(`❌ Error updating SKU ${sku.sku}:`, skuUpdateError);
              skuErrorCount++;
            } else {
              skuUpdatedCount++;
              if (skuUpdatedCount % 100 === 0) {
                console.log(`  SKU Progress: ${skuUpdatedCount} / ${skus.length} updated`);
              }
            }
          }
        }

        console.log(`✅ SKU backfill completed: ${skuUpdatedCount} updated, ${skuErrorCount} errors`);
      }
    } else {
      console.log("✅ No SKUs with NULL tax_rate found");
    }

    return new Response(
      JSON.stringify({
        message: "Backfill completed successfully",
        ordersUpdated: updatedCount,
        ordersErrors: errorCount,
        totalOrders: orders.length,
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
