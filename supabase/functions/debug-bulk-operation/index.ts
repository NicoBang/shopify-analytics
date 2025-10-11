// Debug bulk operation in Edge Function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const { shop, date } = await req.json();

    // Get token
    const tokenName = shop.includes("-da") ? "SHOPIFY_TOKEN_DA" :
                      shop.includes("-de") ? "SHOPIFY_TOKEN_DE" :
                      shop.includes("-nl") ? "SHOPIFY_TOKEN_NL" :
                      shop.includes("-int") ? "SHOPIFY_TOKEN_INT" :
                      shop.includes("-chf") ? "SHOPIFY_TOKEN_CHF" : null;

    const token = tokenName ? Deno.env.get(tokenName) : null;

    if (!token) {
      return new Response(
        JSON.stringify({ error: `Token not found for ${shop}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Token found: ${token.substring(0, 10)}... (length: ${token.length})`);
    console.log(`Shop: ${shop}`);
    console.log(`Date: ${date}`);

    // Check current bulk operation
    const checkQuery = `
      query {
        currentBulkOperation {
          id
          status
          errorCode
          createdAt
        }
      }
    `;

    const checkResponse = await fetch(
      `https://${shop}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: checkQuery }),
      }
    );

    const checkData = await checkResponse.json();
    console.log("Check response status:", checkResponse.status);
    console.log("Check response:", JSON.stringify(checkData, null, 2));

    // Try to start a simple bulk operation
    const startQuery = `
      mutation {
        bulkOperationRunQuery(
          query: """
          {
            orders(
              first: 10
              query: "created_at:>='${date}T00:00:00Z' AND created_at:<='${date}T23:59:59Z'"
            ) {
              edges {
                node {
                  id
                  name
                  createdAt
                }
              }
            }
          }
          """
        ) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const startResponse = await fetch(
      `https://${shop}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: startQuery }),
      }
    );

    const startData = await startResponse.json();
    console.log("Start response status:", startResponse.status);
    console.log("Start response:", JSON.stringify(startData, null, 2));

    return new Response(
      JSON.stringify({
        success: true,
        checkOperation: checkData.data?.currentBulkOperation,
        startOperation: startData.data?.bulkOperationRunQuery,
        errors: startData.errors,
        tokenUsed: token.substring(0, 10) + "...",
        shop,
        date,
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