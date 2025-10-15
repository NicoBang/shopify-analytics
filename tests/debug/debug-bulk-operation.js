#!/usr/bin/env node

/**
 * Debug Shopify Bulk Operations directly
 * This bypasses Supabase to test Shopify API directly
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

async function checkCurrentBulkOperation() {
  const query = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        url
        objectCount
        createdAt
        completedAt
      }
    }
  `;

  const result = await makeGraphQLRequest(query);
  return result.data?.currentBulkOperation;
}

async function cancelBulkOperation() {
  const query = `
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

  const result = await makeGraphQLRequest(query);
  return result;
}

async function startBulkOperation(startDate, endDate) {
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
  return result;
}

async function debugBulkOperations() {
  console.log('🔍 Debugging Shopify Bulk Operations\n');
  console.log(`Shop: ${SHOP}`);
  console.log(`API Version: ${API_VERSION}`);
  console.log('-------------------------------------------\n');

  // Step 1: Check current bulk operation
  console.log('1. Checking current bulk operation...');
  const current = await checkCurrentBulkOperation();

  if (current) {
    console.log(`   ✅ Found existing operation:`);
    console.log(`      ID: ${current.id}`);
    console.log(`      Status: ${current.status}`);
    console.log(`      Error: ${current.errorCode || 'None'}`);
    console.log(`      Objects: ${current.objectCount || 0}`);
    console.log(`      Created: ${current.createdAt}`);

    if (current.status === 'RUNNING' || current.status === 'CREATED') {
      console.log('\n2. Cancelling existing operation...');
      const cancelResult = await cancelBulkOperation();

      if (cancelResult.data?.bulkOperationCancel?.userErrors?.length > 0) {
        console.log(`   ❌ Cancel failed:`, cancelResult.data.bulkOperationCancel.userErrors);
      } else {
        console.log(`   ✅ Operation cancelled successfully`);
      }

      // Wait for cancellation
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } else {
    console.log('   ℹ️ No existing bulk operation found');
  }

  // Step 2: Try to start a new operation with yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`\n3. Starting new bulk operation for ${dateStr}...`);
  const startResult = await startBulkOperation(dateStr, dateStr);

  if (startResult.errors) {
    console.log(`   ❌ GraphQL errors:`, startResult.errors);
  } else if (startResult.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    console.log(`   ❌ User errors:`, startResult.data.bulkOperationRunQuery.userErrors);
  } else if (startResult.data?.bulkOperationRunQuery?.bulkOperation) {
    const op = startResult.data.bulkOperationRunQuery.bulkOperation;
    console.log(`   ✅ Operation started successfully!`);
    console.log(`      ID: ${op.id}`);
    console.log(`      Status: ${op.status}`);

    // Wait and check status
    console.log('\n4. Waiting 5 seconds and checking status...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const statusCheck = await checkCurrentBulkOperation();
    if (statusCheck) {
      console.log(`   Status after 5s: ${statusCheck.status}`);
      console.log(`   Objects: ${statusCheck.objectCount || 0}`);
      console.log(`   Error: ${statusCheck.errorCode || 'None'}`);
    }
  } else {
    console.log(`   ⚠️ Unexpected response:`, JSON.stringify(startResult, null, 2));
  }

  console.log('\n-------------------------------------------');
  console.log('✨ Debug complete\n');

  console.log('Common issues and solutions:');
  console.log('1. "Bulk operation already running" → Need to cancel first');
  console.log('2. "Access denied" → Token permissions issue');
  console.log('3. "Invalid query" → GraphQL syntax or date format issue');
  console.log('4. Timeout → Shopify API rate limits or network issues');
}

// Run the debug
debugBulkOperations().catch(console.error);