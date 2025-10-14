import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_TOKENS: { [key: string]: string } = {
  "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA")!,
  "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE")!,
  "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL")!,
  "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT")!,
  "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF")!,
};

interface RequestBody {
  orderId?: string;
  shop?: string;
  dryRun?: boolean;
  limit?: number;
}

async function fetchTaxRateFromShopify(shop: string, orderId: string): Promise<number | null> {
  const token = SHOPIFY_TOKENS[shop];
  if (!token) {
    console.error(`❌ No Shopify token for shop: ${shop}`);
    return null;
  }

  const query = `{
    order(id: "gid://shopify/Order/${orderId}") {
      id
      name
      taxLines {
        rate
        title
        priceSet {
          shopMoney {
            amount
          }
        }
      }
      lineItems(first: 1) {
        edges {
          node {
            taxLines {
              rate
              priceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }`;

  try {
    const response = await fetch(
      `https://${shop}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      console.error(`❌ Shopify API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = await response.json();

    if (result.errors) {
      console.error(`❌ GraphQL errors:`, result.errors);
      return null;
    }

    const order = result.data?.order;
    if (!order) {
      console.log(`⚠️ Order ${orderId} not found in Shopify (might be deleted)`);
      return null;
    }

    // Try order-level taxLines first
    if (order.taxLines && order.taxLines.length > 0) {
      const taxRate = order.taxLines[0].rate;
      console.log(`  ✅ Order ${orderId}: tax rate ${taxRate} (from order.taxLines)`);
      return taxRate;
    }

    // Fallback to line item taxLines
    if (order.lineItems?.edges?.length > 0) {
      const lineItem = order.lineItems.edges[0].node;
      if (lineItem.taxLines && lineItem.taxLines.length > 0) {
        const taxRate = lineItem.taxLines[0].rate;
        console.log(`  ✅ Order ${orderId}: tax rate ${taxRate} (from lineItem.taxLines)`);
        return taxRate;
      }
    }

    // No tax lines found anywhere - order is tax exempt
    console.log(`  ℹ️ Order ${orderId}: No taxLines found (tax exempt order)`);
    return 0; // Tax exempt orders get 0, not NULL

  } catch (error) {
    console.error(`❌ Error fetching tax rate for order ${orderId}:`, error);
    return null;
  }
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
    const { orderId, shop, dryRun = false, limit = 100 } = body;

    console.log(`🔍 Fetching tax_rate from Shopify GraphQL API...`);
    console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);
    console.log(`  Scope: ${orderId ? `Single order ${orderId}` : `All orders with NULL tax_rate (limit: ${limit})`}`);

    let ordersToProcess: Array<{ shop: string; order_id: string }> = [];

    if (orderId && shop) {
      // Single order mode
      ordersToProcess = [{ shop, order_id: orderId }];
    } else {
      // Batch mode - get all orders with NULL tax_rate
      const { data: orders, error: fetchError } = await supabase
        .from("orders")
        .select("shop, order_id")
        .is("tax_rate", null)
        .limit(limit);

      if (fetchError) {
        throw fetchError;
      }

      ordersToProcess = orders || [];
    }

    if (ordersToProcess.length === 0) {
      return new Response(
        JSON.stringify({ message: "No orders to process", count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Processing ${ordersToProcess.length} orders...`);

    const results = {
      total: ordersToProcess.length,
      updated: 0,
      taxExempt: 0,
      notFound: 0,
      errors: 0,
      details: [] as Array<{ order_id: string; shop: string; tax_rate: number | null; status: string }>,
    };

    for (const order of ordersToProcess) {
      // Rate limiting: 500ms delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));

      const taxRate = await fetchTaxRateFromShopify(order.shop, order.order_id);

      if (taxRate === null) {
        results.errors++;
        results.details.push({
          order_id: order.order_id,
          shop: order.shop,
          tax_rate: null,
          status: "error_or_not_found",
        });
        continue;
      }

      if (taxRate === 0) {
        results.taxExempt++;
      }

      results.details.push({
        order_id: order.order_id,
        shop: order.shop,
        tax_rate: taxRate,
        status: "success",
      });

      // Update database if not dry run
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from("orders")
          .update({ tax_rate: taxRate })
          .eq("shop", order.shop)
          .eq("order_id", order.order_id);

        if (updateError) {
          console.error(`❌ Error updating order ${order.order_id}:`, updateError);
          results.errors++;
        } else {
          results.updated++;
        }
      } else {
        results.updated++; // Count as "would update" in dry run
      }

      if (results.updated % 10 === 0) {
        console.log(`  Progress: ${results.updated} / ${ordersToProcess.length}`);
      }
    }

    console.log(`\n✅ Processing complete:`);
    console.log(`  Total processed: ${results.total}`);
    console.log(`  ${dryRun ? "Would update" : "Updated"}: ${results.updated}`);
    console.log(`  Tax exempt (0%): ${results.taxExempt}`);
    console.log(`  Errors/Not found: ${results.errors}`);

    return new Response(
      JSON.stringify({
        message: dryRun ? "Dry run completed" : "Update completed",
        ...results,
      }),
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
