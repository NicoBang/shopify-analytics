// src/test-fetch-orders.js
const ShopifyAPIClient = require('./services/ShopifyAPIClient');
const { CONFIG } = require('./config');

async function testFetchOrders() {
  console.log('🔍 Testing fetchOrders...\n');
  
  // Test med dansk shop og sidste 7 dage
  const shop = CONFIG.SHOPS[0];
  const client = new ShopifyAPIClient(shop);
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7); // 7 dage tilbage
  
  console.log(`📅 Fetching orders from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`🏪 Shop: ${shop.domain}`);
  
  try {
    const orders = await client.fetchOrders(startDate, endDate);
    
    console.log(`\n✅ Success! Found ${orders.length} orders`);
    
    if (orders.length > 0) {
      console.log('\n📦 First order example:');
      const firstOrder = orders[0];
      console.log(`   Order ID: ${firstOrder.orderId}`);
      console.log(`   Created: ${firstOrder.createdAt}`);
      console.log(`   Country: ${firstOrder.country}`);
      console.log(`   Total: ${firstOrder.discountedTotal.toFixed(2)} DKK`);
      console.log(`   Items: ${firstOrder.itemCount}`);
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

// Kør test
testFetchOrders();