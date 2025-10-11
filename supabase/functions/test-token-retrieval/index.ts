// Test token retrieval in Edge Function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getShopifyToken } from "../_shared/shopify.ts";

serve(async (req) => {
  try {
    const { shop } = await req.json();

    console.log(`Shop: ${shop}`);

    // Try direct env access
    const directToken = Deno.env.get("SHOPIFY_TOKEN_DA");
    console.log(`Direct SHOPIFY_TOKEN_DA: ${directToken ? directToken.substring(0, 10) + "..." : "NOT FOUND"}`);

    // Try via getShopifyToken
    let sharedToken = null;
    let sharedError = null;
    try {
      sharedToken = getShopifyToken(shop);
      console.log(`Shared getShopifyToken: ${sharedToken ? sharedToken.substring(0, 10) + "..." : "NOT FOUND"}`);
    } catch (e) {
      sharedError = e.message;
      console.error(`Error from getShopifyToken: ${e.message}`);
    }

    // Test if tokens match
    const tokensMatch = directToken === sharedToken;

    return new Response(
      JSON.stringify({
        shop,
        directTokenExists: !!directToken,
        directTokenPrefix: directToken ? directToken.substring(0, 10) : null,
        sharedTokenExists: !!sharedToken,
        sharedTokenPrefix: sharedToken ? sharedToken.substring(0, 10) : null,
        sharedError,
        tokensMatch,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});