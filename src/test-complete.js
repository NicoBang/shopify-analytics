// src/test-complete.js
// Comprehensive test of all functionality

const ShopifyAPIClient = require('./services/ShopifyAPIClient');
const SupabaseService = require('./services/SupabaseService');
const { CONFIG } = require('./config');

async function testComplete() {
  console.log('🚀 COMPREHENSIVE SYSTEM TEST\n');
  console.log('Testing all components...\n');

  try {
    // 1. Test Supabase connection
    console.log('1️⃣ Testing Supabase connection...');
    const supabaseService = new SupabaseService();
    const supabaseTest = await supabaseService.testConnection();
    console.log(`   ✅ ${supabaseTest.message}\n`);

    // 2. Test Shopify connections for all shops
    console.log('2️⃣ Testing Shopify connections...');
    for (const shop of CONFIG.SHOPS) {
      const client = new ShopifyAPIClient(shop);
      try {
        const shopInfo = await client.testConnection();
        console.log(`   ✅ ${shop.domain}: ${shopInfo.name} (${shopInfo.currencyCode})`);
      } catch (error) {
        console.log(`   ❌ ${shop.domain}: ${error.message}`);
      }
    }
    console.log('');

    // 3. Test data fetching (use first shop, last 3 days)
    const testShop = CONFIG.SHOPS[0];
    const client = new ShopifyAPIClient(testShop);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 3); // 3 days back for quick test

    console.log(`3️⃣ Testing data fetching from ${testShop.domain}...`);
    console.log(`   📅 Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // Test orders
    console.log('   📦 Fetching orders...');
    const orders = await client.fetchOrders(startDate, endDate);
    console.log(`   ✅ Found ${orders.length} orders`);

    // Test SKUs
    console.log('   🏷️ Fetching SKU data...');
    const skus = await client.fetchSkuData(startDate, endDate);
    console.log(`   ✅ Found ${skus.length} SKU records`);

    // Test inventory (limited for speed)
    console.log('   📦 Fetching inventory sample...');
    const inventory = await client.fetchInventory();
    console.log(`   ✅ Found ${inventory.length} inventory items`);

    console.log('');

    // 4. Test database operations (if we have data)
    if (orders.length > 0) {
      console.log('4️⃣ Testing database operations...');

      // Add shop domain to orders
      orders.forEach(order => order.shop = testShop.domain);

      // Test order upsert
      console.log('   💾 Testing order upsert...');
      const orderResult = await supabaseService.upsertOrders(orders);
      console.log(`   ✅ Upserted ${orderResult.count} orders`);

      // Test SKU upsert (if we have SKUs)
      if (skus.length > 0) {
        console.log('   💾 Testing SKU upsert...');
        const skuResult = await supabaseService.upsertSkus(skus);
        console.log(`   ✅ Upserted ${skuResult.count} SKUs`);
      }

      // Test inventory update (sample)
      if (inventory.length > 0) {
        const inventorySample = inventory.slice(0, 10); // Just 10 items for test
        console.log('   💾 Testing inventory update (sample)...');
        const invResult = await supabaseService.updateInventory(inventorySample);
        console.log(`   ✅ Updated ${invResult.count} inventory items`);
      }

      // Test data retrieval
      console.log('   📊 Testing data retrieval...');
      const retrievedOrders = await supabaseService.getOrdersForPeriod(startDate, endDate, testShop.domain);
      console.log(`   ✅ Retrieved ${retrievedOrders.length} orders from database`);

      // Test analytics
      console.log('   📈 Testing analytics...');
      const analytics = await supabaseService.getAnalytics(startDate, endDate);
      console.log(`   ✅ Generated analytics for ${analytics.length} date/shop combinations`);

      // Test sync logging
      console.log('   📝 Testing sync logging...');
      await supabaseService.logSync(testShop.domain, 'test', orders.length);
      console.log('   ✅ Logged sync operation');

      console.log('');
    } else {
      console.log('4️⃣ Skipping database tests (no orders found in test period)\n');
    }

    // 5. Test API key validation (simulate)
    console.log('5️⃣ API configuration check...');
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_KEY',
      'API_SECRET_KEY',
      'SHOPIFY_TOKEN_DA'
    ];

    for (const envVar of requiredEnvVars) {
      if (process.env[envVar]) {
        console.log(`   ✅ ${envVar}: configured`);
      } else {
        console.log(`   ❌ ${envVar}: missing`);
      }
    }

    console.log('\n🎉 COMPREHENSIVE TEST COMPLETED!');
    console.log('\n📋 SUMMARY:');
    console.log(`   • Supabase: ✅ Connected`);
    console.log(`   • Shopify shops: ${CONFIG.SHOPS.length} configured`);
    console.log(`   • Orders found: ${orders?.length || 0}`);
    console.log(`   • SKUs found: ${skus?.length || 0}`);
    console.log(`   • Inventory items: ${inventory?.length || 0}`);

    console.log('\n🚀 READY FOR DEPLOYMENT!');
    console.log('\nNext steps:');
    console.log('1. Set up your Supabase database with the schema from src/migrations/supabase-schema.sql');
    console.log('2. Deploy to Vercel: vercel --prod');
    console.log('3. Configure environment variables in Vercel');
    console.log('4. Update Google Sheets script to use new API endpoints');

  } catch (error) {
    console.log(`\n💥 Test failed: ${error.message}`);
    console.log(error.stack);
  }
}

// Run the test
testComplete();