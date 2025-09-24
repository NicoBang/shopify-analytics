// src/test-supabase-simple.js
// Simpel Supabase test

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function testSupabaseSimple() {
  console.log('🧪 Simple Supabase test...\n');

  try {
    // Create client directly
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    console.log('📡 Testing direct connection...');

    // Test simple query
    const { data, error } = await supabase
      .from('orders')
      .select('count')
      .limit(1);

    if (error) {
      console.log(`❌ Error: ${error.message}`);
      console.log(`Error details:`, error);
    } else {
      console.log('✅ Orders table accessible!');
      console.log('Data:', data);
    }

    // Test all tables
    const tables = ['orders', 'skus', 'inventory', 'product_metadata', 'fulfillments', 'sync_log'];

    console.log('\n📋 Testing all tables...');
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error) {
          console.log(`❌ ${table}: ${error.message}`);
        } else {
          console.log(`✅ ${table}: OK`);
        }
      } catch (err) {
        console.log(`❌ ${table}: ${err.message}`);
      }
    }

  } catch (error) {
    console.log(`❌ Connection failed: ${error.message}`);
  }
}

testSupabaseSimple();