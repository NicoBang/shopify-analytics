#!/usr/bin/env node

/**
 * Test improved bulk-sync-orders with timeout fixes
 * This tests the updated function that:
 * 1. Checks for and cancels existing bulk operations
 * 2. Adds delay for same-day queries
 * 3. Has better error handling and logging
 * 4. ONLY handles orders (no SKUs or "both")
 */

const https = require('https');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables. Please check .env.local');
  process.exit(1);
}

// Parse the base URL for the request
const url = new URL(`${SUPABASE_URL}/functions/v1/bulk-sync-orders`);

async function makeRequest(data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: result });
        } catch (err) {
          resolve({ statusCode: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing improved bulk-sync-orders with timeout fixes\n');
  console.log('Key improvements:');
  console.log('✅ Checks for and cancels existing bulk operations');
  console.log('✅ Adds delay for same-day queries');
  console.log('✅ Better error handling and logging');
  console.log('✅ ONLY handles orders (no SKUs)');
  console.log('-------------------------------------------\n');

  const tests = [
    {
      name: 'Test 1: Historical single day (should work)',
      data: {
        shop: 'pompdelux-da.myshopify.com',
        startDate: '2025-10-01',
        endDate: '2025-10-01',
        testMode: true,
      },
    },
    {
      name: 'Test 2: Same-day query (with delay)',
      data: {
        shop: 'pompdelux-da.myshopify.com',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        testMode: true,
      },
    },
    {
      name: 'Test 3: Recent multi-day range',
      data: {
        shop: 'pompdelux-da.myshopify.com',
        startDate: '2025-10-10',
        endDate: '2025-10-11',
        testMode: true,
      },
    },
  ];

  for (const test of tests) {
    console.log(`\n📝 ${test.name}`);
    console.log(`   Date range: ${test.data.startDate} to ${test.data.endDate}`);

    try {
      const result = await makeRequest(test.data);

      if (result.statusCode === 200) {
        console.log(`   ✅ Success! Status: ${result.statusCode}`);
        if (result.data) {
          console.log(`   📊 Result: ${result.data.message || 'No message'}`);
          if (result.data.details) {
            console.log(`      - Days processed: ${result.data.details.daysProcessed || 0}`);
            console.log(`      - Total records: ${result.data.details.totalRecords || 0}`);
            console.log(`      - Errors: ${result.data.details.errors?.length || 0}`);
          }
        }
      } else {
        console.log(`   ⚠️ Non-200 response: ${result.statusCode}`);
        console.log(`   Response: ${JSON.stringify(result.data, null, 2)}`);
      }
    } catch (error) {
      console.error(`   ❌ Test failed: ${error.message}`);
    }
  }

  console.log('\n-------------------------------------------');
  console.log('✨ Test suite completed\n');
  console.log('Note: In test mode, no data is written to the database.');
  console.log('The improvements handle:');
  console.log('  1. Concurrent bulk operation conflicts');
  console.log('  2. Same-day indexing delays');
  console.log('  3. Better error reporting');
  console.log('  4. Clear separation - ONLY orders, no SKUs');
}

// Run the tests
runTests().catch(console.error);