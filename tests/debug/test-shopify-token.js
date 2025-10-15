#!/usr/bin/env node

/**
 * Test Shopify token directly
 * Check if token works for basic and bulk operations
 */

require('dotenv').config({ path: '.env.local' });
const https = require('https');

const SHOP = 'pompdelux-da.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN_DA;
const API_VERSION = '2025-01';

if (!TOKEN) {
  console.error('❌ Missing SHOPIFY_TOKEN_DA in .env.local');
  process.exit(1);
}

console.log(`🔍 Testing Shopify token for ${SHOP}`);
console.log(`Token prefix: ${TOKEN.substring(0, 10)}...`);
console.log(`API Version: ${API_VERSION}`);
console.log('-------------------------------------------\n');

async function makeGraphQLRequest(query) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SHOP,
      port: 443,
      path: `/admin/api/${API_VERSION}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify({ query }));
    req.end();
  });
}

async function testBasicQuery() {
  console.log('1. Testing basic shop query...');

  const query = `
    query {
      shop {
        name
        email
        primaryDomain {
          host
        }
      }
    }
  `;

  const result = await makeGraphQLRequest(query);

  if (result.status === 200 && result.data?.data?.shop) {
    console.log(`   ✅ Basic query works!`);
    console.log(`      Shop: ${result.data.data.shop.name}`);
    console.log(`      Domain: ${result.data.data.shop.primaryDomain.host}`);
    return true;
  } else {
    console.log(`   ❌ Basic query failed!`);
    console.log(`      Status: ${result.status}`);
    console.log(`      Response:`, JSON.stringify(result.data, null, 2));
    return false;
  }
}

async function testOrderQuery() {
  console.log('\n2. Testing order query...');

  const query = `
    query {
      orders(first: 1) {
        edges {
          node {
            id
            name
            createdAt
          }
        }
      }
    }
  `;

  const result = await makeGraphQLRequest(query);

  if (result.status === 200 && result.data?.data?.orders) {
    const orders = result.data.data.orders.edges;
    console.log(`   ✅ Order query works!`);
    console.log(`      Found ${orders.length} order(s)`);
    if (orders.length > 0) {
      console.log(`      Latest: ${orders[0].node.name}`);
    }
    return true;
  } else {
    console.log(`   ❌ Order query failed!`);
    console.log(`      Status: ${result.status}`);
    console.log(`      Response:`, JSON.stringify(result.data, null, 2));
    return false;
  }
}

async function testBulkOperationPermission() {
  console.log('\n3. Testing bulk operation permissions...');

  // First check current bulk operation
  const checkQuery = `
    query {
      currentBulkOperation {
        id
        status
      }
    }
  `;

  const checkResult = await makeGraphQLRequest(checkQuery);

  if (checkResult.status !== 200) {
    console.log(`   ❌ Cannot check bulk operations!`);
    console.log(`      Status: ${checkResult.status}`);
    console.log(`      Response:`, JSON.stringify(checkResult.data, null, 2));
    return false;
  }

  console.log(`   ✅ Can check bulk operations`);

  // Try to start a small bulk operation
  const startQuery = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products(first: 1) {
            edges {
              node {
                id
                title
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

  const startResult = await makeGraphQLRequest(startQuery);

  if (startResult.status === 200 && startResult.data?.data?.bulkOperationRunQuery) {
    const op = startResult.data.data.bulkOperationRunQuery;
    if (op.userErrors?.length > 0) {
      console.log(`   ❌ Cannot start bulk operations!`);
      console.log(`      Errors:`, op.userErrors);
      return false;
    }
    if (op.bulkOperation) {
      console.log(`   ✅ Can start bulk operations`);
      console.log(`      Operation ID: ${op.bulkOperation.id}`);

      // Try to cancel it
      const cancelQuery = `
        mutation {
          bulkOperationCancel {
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

      await makeGraphQLRequest(cancelQuery);
      console.log(`      Cleanup: Cancelled test operation`);

      return true;
    }
  }

  console.log(`   ⚠️ Bulk operation permission unclear`);
  return false;
}

async function checkScopes() {
  console.log('\n4. Checking API access scopes...');

  // Try to get app installation details
  const query = `
    query {
      app {
        apiKey
        handle
      }
    }
  `;

  const result = await makeGraphQLRequest(query);

  // This query usually fails for private apps, which is OK
  console.log(`   ℹ️ Access token type: ${result.data?.data?.app ? 'App token' : 'Private app token'}`);
}

async function runTests() {
  const basicWorks = await testBasicQuery();
  if (!basicWorks) {
    console.log('\n❌ CRITICAL: Token does not work for basic queries!');
    console.log('Please check:');
    console.log('  1. Token is valid and not expired');
    console.log('  2. Token has correct permissions');
    console.log('  3. Shop domain is correct');
    return;
  }

  const orderWorks = await testOrderQuery();
  const bulkWorks = await testBulkOperationPermission();
  await checkScopes();

  console.log('\n-------------------------------------------');
  console.log('📊 Summary:');
  console.log(`  Basic queries: ${basicWorks ? '✅' : '❌'}`);
  console.log(`  Order queries: ${orderWorks ? '✅' : '❌'}`);
  console.log(`  Bulk operations: ${bulkWorks ? '✅' : '❌'}`);

  if (!bulkWorks) {
    console.log('\n⚠️ Bulk operations not working!');
    console.log('Possible solutions:');
    console.log('  1. Regenerate the API token with "read_orders" scope');
    console.log('  2. Use a different API version (try 2024-10)');
    console.log('  3. Check if bulk operations are enabled for this shop');
  }
}

// Run the tests
runTests().catch(console.error);