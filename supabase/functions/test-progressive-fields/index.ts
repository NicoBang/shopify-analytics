// Test progressive field addition to identify which fields cause ACCESS_DENIED
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const { shop, startDate, endDate, testLevel } = await req.json();

    // Get token directly
    const token = Deno.env.get("SHOPIFY_TOKEN_DA");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token not found" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Testing level ${testLevel} with shop: ${shop}`);
    console.log(`Date range: ${startDate} to ${endDate}`);

    // Progressive field sets
    const fieldSets = {
      1: `
        id
        name
        createdAt
      `,
      2: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
      `,
      3: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      `,
      4: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
      `,
      5: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
      `,
      6: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        customer {
          email
        }
      `,
      7: `
        id
        name
        createdAt
        updatedAt
        cancelledAt
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        customer {
          email
        }
        billingAddress {
          country
          city
          province
        }
      `
    };

    const fields = fieldSets[testLevel] || fieldSets[1];

    const query = `
      mutation {
        bulkOperationRunQuery(
          query: """
          {
            orders(
              query: "created_at:>='${startDate}T00:00:00Z' AND created_at:<='${endDate}T23:59:59Z'"
              sortKey: CREATED_AT
            ) {
              edges {
                node {
                  ${fields}
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

    const response = await fetch(
      `https://${shop}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    console.log("Response status:", response.status);
    console.log("Response data:", JSON.stringify(data, null, 2));

    if (data.errors) {
      return new Response(
        JSON.stringify({
          testLevel,
          error: "GraphQL errors",
          details: data.errors
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = data.data?.bulkOperationRunQuery;

    if (result?.userErrors?.length > 0) {
      return new Response(
        JSON.stringify({
          testLevel,
          error: "User errors",
          details: result.userErrors
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (result?.bulkOperation) {
      // Wait a bit then check status
      await new Promise(resolve => setTimeout(resolve, 3000));

      const checkQuery = `
        query {
          node(id: "${result.bulkOperation.id}") {
            ... on BulkOperation {
              status
              errorCode
              objectCount
            }
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
      const status = checkData.data?.node;

      const fieldDescription = {
        1: "Basic fields (id, name, createdAt)",
        2: "Basic + timestamps (updatedAt, cancelledAt)",
        3: "Basic + subtotalPriceSet",
        4: "Basic + all price fields",
        5: "Basic + all price fields + shipping",
        6: "Basic + all price fields + shipping + customer",
        7: "Full query (all fields)"
      };

      return new Response(
        JSON.stringify({
          testLevel,
          fieldsTested: fieldDescription[testLevel],
          success: true,
          operation: result.bulkOperation,
          finalStatus: status
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        testLevel,
        error: "Failed to start operation"
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});