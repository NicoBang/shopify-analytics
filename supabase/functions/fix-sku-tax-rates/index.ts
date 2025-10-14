import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

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

    console.log("🔧 Fixing SKUs with NULL tax_rate by copying from parent orders...");

    // Use raw SQL to update SKUs efficiently
    const { data, error } = await supabase.rpc("exec_raw_sql", {
      query: `
        UPDATE skus
        SET tax_rate = orders.tax_rate
        FROM orders
        WHERE skus.shop = orders.shop
          AND skus.order_id = orders.order_id
          AND skus.tax_rate IS NULL
          AND orders.tax_rate IS NOT NULL;
      `
    });

    if (error) {
      // Fallback to manual update if RPC doesn't exist
      console.log("⚠️ RPC not available, using manual update...");

      const { data: skusData, error: fetchError } = await supabase
        .from("skus")
        .select("shop, order_id, sku")
        .is("tax_rate", null);

      if (fetchError) {
        throw fetchError;
      }

      if (!skusData || skusData.length === 0) {
        return new Response(
          JSON.stringify({ message: "No SKUs to update", count: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`📊 Found ${skusData.length} SKUs to update`);

      // Get unique order IDs
      const orderIds = [...new Set(skusData.map(s => s.order_id))];

      // Fetch tax_rates from orders
      const { data: ordersData, error: ordersError } = await supabase
        .from("orders")
        .select("shop, order_id, tax_rate")
        .in("order_id", orderIds);

      if (ordersError) {
        throw ordersError;
      }

      // Build map of order_id -> tax_rate
      const taxRateMap = new Map<string, number>();
      for (const order of ordersData || []) {
        if (order.tax_rate !== null) {
          taxRateMap.set(`${order.shop}:${order.order_id}`, order.tax_rate);
        }
      }

      // Update SKUs
      let updated = 0;
      let errors = 0;

      for (const sku of skusData) {
        const key = `${sku.shop}:${sku.order_id}`;
        const taxRate = taxRateMap.get(key);

        if (taxRate !== undefined) {
          const { error: updateError } = await supabase
            .from("skus")
            .update({ tax_rate: taxRate })
            .eq("shop", sku.shop)
            .eq("order_id", sku.order_id)
            .eq("sku", sku.sku);

          if (updateError) {
            console.error(`❌ Error updating SKU ${sku.sku}:`, updateError);
            errors++;
          } else {
            updated++;
            if (updated % 100 === 0) {
              console.log(`  Progress: ${updated} / ${skusData.length}`);
            }
          }
        }
      }

      console.log(`✅ Updated ${updated} SKUs, ${errors} errors`);

      return new Response(
        JSON.stringify({
          message: "Fix completed",
          updated,
          errors,
          total: skusData.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ SQL update successful");
    return new Response(
      JSON.stringify({ message: "SKUs updated successfully via SQL" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
