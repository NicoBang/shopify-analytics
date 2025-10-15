#!/usr/bin/env node

/**
 * Force clear stuck bulk operations by creating a tiny successful one
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

async function forceClearBulkOperations() {
  console.log('🧹 Force clearing stuck bulk operations...\n');

  // Step 1: Try to cancel any existing operation
  console.log('1️⃣ Attempting to cancel current operation...');
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
    console.log('   Cancel errors:', cancelResult.data.bulkOperationCancel.userErrors);
  } else {
    console.log('   Cancel request sent');
  }

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Create a minimal bulk operation that should succeed
  console.log('\n2️⃣ Creating minimal bulk operation to clear the queue...');
  const minimalQuery = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products(first: 1) {
            edges {
              node {
                id
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

  const result = await makeGraphQLRequest(minimalQuery);

  if (result.errors) {
    console.error('❌ GraphQL errors:', result.errors);
    return false;
  }

  if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    console.error('❌ User errors:', result.data.bulkOperationRunQuery.userErrors);

    // If we get "Bulk operation already running", try with a product query
    const errors = result.data.bulkOperationRunQuery.userErrors;
    if (errors.some(e => e.message.includes('already running'))) {
      console.log('\n3️⃣ Previous operation still blocking, waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Try once more
      console.log('4️⃣ Trying one more time...');
      const retryResult = await makeGraphQLRequest(minimalQuery);

      if (retryResult.data?.bulkOperationRunQuery?.bulkOperation) {
        console.log('✅ Successfully started new operation:', retryResult.data.bulkOperationRunQuery.bulkOperation.id);
        return true;
      } else {
        console.error('❌ Still blocked. The failed operation needs to clear on Shopify\'s side.');
        console.log('\n💡 Recommendation: Wait 5-10 minutes and try again, or contact Shopify support.');
        return false;
      }
    }
    return false;
  }

  const newOp = result.data?.bulkOperationRunQuery?.bulkOperation;
  if (newOp) {
    console.log('✅ Successfully started new operation:', newOp.id);
    console.log('   Status:', newOp.status);

    // Wait for it to complete
    console.log('\n5️⃣ Waiting for operation to complete...');
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const checkQuery = `
        query {
          currentBulkOperation {
            id
            status
            errorCode
          }
        }
      `;

      const checkResult = await makeGraphQLRequest(checkQuery);
      const currentOp = checkResult.data?.currentBulkOperation;

      if (currentOp) {
        console.log(`   Attempt ${i + 1}: Status = ${currentOp.status}`);

        if (currentOp.status === 'COMPLETED') {
          console.log('\n✅ Operation completed successfully!');
          console.log('The stuck operation has been cleared.');
          return true;
        }

        if (currentOp.status === 'FAILED') {
          console.log(`\n❌ Operation failed: ${currentOp.errorCode}`);
          return false;
        }
      }
    }

    console.log('\n⏱️ Operation still running after 20 seconds');
    console.log('It should complete soon and clear the stuck state.');
    return true;
  }

  return false;
}

// Run the cleanup
forceClearBulkOperations()
  .then(success => {
    if (success) {
      console.log('\n🎉 Cleanup successful! You should now be able to run bulk-sync-orders.');
    } else {
      console.log('\n⚠️ Cleanup was not fully successful. Please try again in a few minutes.');
    }
  })
  .catch(console.error);