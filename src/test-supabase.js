// src/test-supabase.js
// Test Supabase forbindelse

// Load environment variables first
require('dotenv').config({ path: '.env.local' });

const SupabaseService = require('./services/SupabaseService');

async function testSupabase() {
  console.log('🧪 Testing Supabase connection...\n');

  // Debug environment variables
  console.log('🔍 Environment variables check:');
  console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log('');

  try {
    // Test connection
    console.log('1️⃣ Testing basic connection...');
    const supabaseService = new SupabaseService();
    const connectionTest = await supabaseService.testConnection();
    console.log(`   ✅ ${connectionTest.message}`);

    // Test table existence by querying each table
    console.log('\n2️⃣ Testing database tables...');

    const tables = [
      'orders',
      'skus',
      'inventory',
      'product_metadata',
      'fulfillments',
      'sync_log'
    ];

    for (const table of tables) {
      try {
        const { data, error } = await supabaseService.supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error) {
          console.log(`   ❌ Table '${table}': ${error.message}`);
        } else {
          console.log(`   ✅ Table '${table}': OK`);
        }
      } catch (err) {
        console.log(`   ❌ Table '${table}': ${err.message}`);
      }
    }

    console.log('\n3️⃣ Testing insert operation...');

    // Test sync_log insert (safe test)
    await supabaseService.logSync('test-shop', 'test', 0, null);
    console.log('   ✅ Insert test: OK');

    console.log('\n✅ SUPABASE TEST COMPLETED!');
    console.log('Ready for next step: Test Shopify integration');

  } catch (error) {
    console.log(`\n❌ Supabase test failed: ${error.message}`);
    console.log('\n🔧 CHECK YOUR .env.local FILE:');
    console.log('   - SUPABASE_URL should be: https://your-project.supabase.co');
    console.log('   - SUPABASE_SERVICE_KEY should be your service_role key (not anon key)');
    console.log('   - Keys can be found in Supabase Dashboard → Settings → API');
  }
}

testSupabase();