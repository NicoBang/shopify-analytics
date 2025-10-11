#!/usr/bin/env node

/**
 * Check the current bulk operation status in Shopify
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
  console.log('🔍 Checking current bulk operation status...\n');

  const query = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        url
      }
    }
  `;

  const result = await makeGraphQLRequest(query);

  if (result.errors) {
    console.error('❌ GraphQL errors:', result.errors);
    return;
  }

  const op = result.data?.currentBulkOperation;

  if (!op) {
    console.log('✅ No current bulk operation found - ready to start new operations');
    return;
  }

  console.log('📊 Current bulk operation:');
  console.log('   ID:', op.id);
  console.log('   Status:', op.status);
  console.log('   Error:', op.errorCode || 'None');
  console.log('   Created:', op.createdAt);
  console.log('   Completed:', op.completedAt || 'Not yet');
  console.log('   Objects:', op.objectCount || 0);

  if (op.status === 'FAILED' && op.errorCode === 'ACCESS_DENIED') {
    console.log('\n⚠️ WARNING: There is a failed bulk operation with ACCESS_DENIED');
    console.log('This might be causing issues with new operations.');
    console.log('\nTo fix, you can:');
    console.log('1. Try cancelling it (even though it\'s failed)');
    console.log('2. Wait for it to clear automatically');
    console.log('3. Contact Shopify support if it persists');

    // Try to cancel even if failed
    console.log('\n🔄 Attempting to cancel the failed operation...');

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

    const cancelResult = await makeGraphQLRequest(cancelQuery);

    if (cancelResult.data?.bulkOperationCancel?.userErrors?.length > 0) {
      console.log('❌ Cancel failed:', cancelResult.data.bulkOperationCancel.userErrors);
    } else if (cancelResult.data?.bulkOperationCancel?.bulkOperation) {
      console.log('✅ Cancel attempt completed');
    }
  } else if (op.status === 'RUNNING' || op.status === 'CREATED') {
    console.log('\n⚠️ There is an active bulk operation');
    console.log('New operations cannot start until this completes or is cancelled');
  }
}

// Run the check
checkCurrentBulkOperation().catch(console.error);