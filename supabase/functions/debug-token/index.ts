// Debug function to test token retrieval
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const { shop } = await req.json();

    // List all environment variables starting with SHOPIFY_TOKEN
    const envVars: Record<string, boolean> = {};
    const tokenKeys = ["SHOPIFY_TOKEN_DA", "SHOPIFY_TOKEN_DE", "SHOPIFY_TOKEN_NL", "SHOPIFY_TOKEN_INT", "SHOPIFY_TOKEN_CHF"];

    for (const key of tokenKeys) {
      const value = Deno.env.get(key);
      envVars[key] = !!value;
      if (value) {
        console.log(`${key}: Found (length: ${value.length})`);
      } else {
        console.log(`${key}: NOT FOUND`);
      }
    }

    // Try to get the specific token for the shop
    const shopKey = shop.includes("-da") ? "DA" :
                   shop.includes("-de") ? "DE" :
                   shop.includes("-nl") ? "NL" :
                   shop.includes("-int") ? "INT" :
                   shop.includes("-chf") ? "CHF" : null;

    const tokenName = shopKey ? `SHOPIFY_TOKEN_${shopKey}` : null;
    const token = tokenName ? Deno.env.get(tokenName) : null;

    return new Response(
      JSON.stringify({
        shop,
        shopKey,
        tokenName,
        tokenFound: !!token,
        tokenLength: token ? token.length : 0,
        envVarsFound: envVars,
        tokenPrefix: token ? token.substring(0, 10) + "..." : null
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});