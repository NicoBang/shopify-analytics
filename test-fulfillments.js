// Test script to debug fulfillments issue
const axios = require('axios');

class ShopifyTester {
  constructor() {
    this.endpoint = `https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json`;
    this.headers = {
      'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN_DA,
      'Content-Type': 'application/json'
    };
  }

  async testSingleOrder(orderId) {
    const query = `
      query {
        order(id: "gid://shopify/Order/${orderId}") {
          id
          createdAt
          shippingAddress { countryCode }
          fulfillments {
            id
            createdAt
            updatedAt
            trackingCompany
            status
            lineItems(first: 100) {
              edges {
                node {
                  quantity
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post(this.endpoint, { query }, { headers: this.headers });
      console.log('✅ Single order fulfillment test:');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('❌ Error testing single order:', error.message);
    }
  }

  async testOrdersWithFulfillments() {
    const query = `
      query {
        orders(first: 5, query: "created_at:>=2024-09-30 created_at:<=2024-10-01") {
          edges {
            node {
              id
              createdAt
              fulfillments {
                id
                createdAt
                status
                trackingCompany
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post(this.endpoint, { query }, { headers: this.headers });
      console.log('✅ Multiple orders fulfillment test:');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('❌ Error testing multiple orders:', error.message);
    }
  }
}

async function main() {
  const tester = new ShopifyTester();

  console.log('🧪 Testing fulfillments...');

  // Test specific order
  await tester.testSingleOrder('6181338775886');

  console.log('\n---\n');

  // Test multiple orders
  await tester.testOrdersWithFulfillments();
}

main().catch(console.error);