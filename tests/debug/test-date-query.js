#!/usr/bin/env node

/**
 * Test different date query formats for bulk operations
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
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify({ query }));
    req.end();
  });
}

async function testDateQuery(dateFilter) {
  console.log(`\nTesting query: ${dateFilter}`);

  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(
            query: "${dateFilter}"
            sortKey: CREATED_AT
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

  const result = await makeGraphQLRequest(query);

  if (result.errors) {
    console.error('   ❌ GraphQL errors:', result.errors);
    return false;
  }

  if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    console.error('   ❌ User errors:', result.data.bulkOperationRunQuery.userErrors);
    return false;
  }

  const op = result.data?.bulkOperationRunQuery?.bulkOperation;
  if (op) {
    console.log(`   ✅ Operation created: ${op.id}`);
    console.log(`   Status: ${op.status}`);

    // Wait a moment then check status
    await new Promise(resolve => setTimeout(resolve, 3000));

    const checkQuery = `
      query {
        node(id: "${op.id}") {
          ... on BulkOperation {
            status
            errorCode
            objectCount
          }
        }
      }
    `;

    const checkResult = await makeGraphQLRequest(checkQuery);
    const status = checkResult.data?.node;

    if (status) {
      console.log(`   Final status: ${status.status}`);
      if (status.errorCode) {
        console.log(`   Error: ${status.errorCode}`);
      }
      if (status.objectCount) {
        console.log(`   Objects: ${status.objectCount}`);
      }
    }

    // Cancel to clean up
    await makeGraphQLRequest(`
      mutation {
        bulkOperationCancel {
          bulkOperation { id }
          userErrors { message }
        }
      }
    `);

    return status?.errorCode !== 'ACCESS_DENIED';
  }

  return false;
}

async function runTests() {
  console.log('🧪 Testing different date query formats...\n');

  // First clear any existing operation
  console.log('🧹 Clearing any existing operations...');
  await makeGraphQLRequest(`
    mutation {
      bulkOperationCancel {
        bulkOperation { id }
        userErrors { message }
      }
    }
  `);
  await new Promise(resolve => setTimeout(resolve, 2000));

  const formats = [
    // Format 1: Exact format used in Edge Function
    "created_at:>='2025-10-10T00:00:00Z' AND created_at:<='2025-10-10T23:59:59Z'",

    // Format 2: Without AND
    "created_at:>='2025-10-10T00:00:00Z' created_at:<='2025-10-10T23:59:59Z'",

    // Format 3: Date range syntax
    "created_at:>=2025-10-10 created_at:<=2025-10-10",

    // Format 4: Simple date
    "created_at:2025-10-10",
  ];

  for (const format of formats) {
    const success = await testDateQuery(format);
    if (!success) {
      console.log('   🚫 This format causes ACCESS_DENIED\n');
    } else {
      console.log('   ✅ This format works!\n');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

runTests().catch(console.error);