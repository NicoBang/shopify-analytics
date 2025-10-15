#!/usr/bin/env node

/**
 * Test script for improved bulk-sync-orders function
 * Tests the refactored function with test mode enabled
 */

const fetch = require('node-fetch');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load from .env.local file
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

async function testImprovedSync() {
  console.log('🧪 Testing improved bulk-sync-orders function...\n');

  // Test parameters
  const testCases = [
    {
      name: 'Test single day sync',
      shop: 'pompdelux-da.myshopify.com',
      startDate: '2025-10-01',
      endDate: '2025-10-01',
      testMode: true
    },
    {
      name: 'Test multi-day sync',
      shop: 'pompdelux-da.myshopify.com',
      startDate: '2025-10-01',
      endDate: '2025-10-03',
      testMode: true
    },
    {
      name: 'Test different shop',
      shop: 'pompdelux-de.myshopify.com',
      startDate: '2025-10-01',
      endDate: '2025-10-01',
      testMode: true
    }
  ];

  const results = [];

  for (const testCase of testCases) {
    console.log(`\n📝 Running: ${testCase.name}`);
    console.log(`   Shop: ${testCase.shop}`);
    console.log(`   Period: ${testCase.startDate} to ${testCase.endDate}`);
    console.log(`   Test Mode: ${testCase.testMode ? 'Yes' : 'No'}`);

    try {
      const startTime = Date.now();

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bulk-sync-orders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testCase),
        }
      );

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      results.push({
        test: testCase.name,
        success: data.success,
        message: data.message,
        recordsProcessed: data.details?.totalRecords || 0,
        duration: `${(duration / 1000).toFixed(2)}s`,
        testMode: data.testMode
      });

      console.log(`   ✅ Success: ${data.message}`);
      console.log(`   📊 Records: ${data.details?.totalRecords || 0}`);
      console.log(`   ⏱️ Duration: ${(duration / 1000).toFixed(2)}s`);

    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      results.push({
        test: testCase.name,
        success: false,
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  console.table(results);

  const allPassed = results.every(r => r.success !== false);

  if (allPassed) {
    console.log('\n✅ All tests passed successfully!');
    console.log('💡 Note: All tests ran in test mode - no production data was affected');
  } else {
    console.log('\n❌ Some tests failed. Please review the errors above.');
  }

  return allPassed;
}

// Validate shared utilities
async function validateSharedUtilities() {
  console.log('\n🔍 Validating shared utilities structure...\n');

  const requiredFiles = [
    'supabase/functions/_shared/config.ts',
    'supabase/functions/_shared/shopify.ts',
    'supabase/functions/_shared/supabase.ts',
    'supabase/functions/_shared/types.ts'
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file} exists`);
    } else {
      console.log(`❌ ${file} is missing`);
      return false;
    }
  }

  return true;
}

// Main execution
async function main() {
  console.log('🚀 Starting improved bulk-sync-orders test suite\n');

  // Check environment
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing required environment variables:');
    if (!SUPABASE_URL) console.error('   - SUPABASE_URL');
    if (!SERVICE_KEY) console.error('   - SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Validate utilities
  const utilitiesValid = await validateSharedUtilities();
  if (!utilitiesValid) {
    console.error('❌ Shared utilities validation failed');
    process.exit(1);
  }

  console.log('\n✅ All shared utilities are in place');
  console.log('='.repeat(60));

  // Run tests
  const testsPass = await testImprovedSync();

  process.exit(testsPass ? 0 : 1);
}

main().catch(console.error);