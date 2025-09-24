// src/test-shopify.js
const ShopifyAPIClient = require('./services/ShopifyAPIClient');
const { CONFIG } = require('./config');

async function testShopifyConnection() {
  console.log('🔍 Testing Shopify connections...\n');
  
  // Test kun den danske shop først
  const danskShop = CONFIG.SHOPS[0];
  console.log(`Testing ${danskShop.domain}...`);
  
  try {
    const client = new ShopifyAPIClient(danskShop);
    const shopInfo = await client.testConnection();
    
    console.log(`✅ Connection successful!`);
    console.log(`   Shop name: ${shopInfo.name}`);
    console.log(`   Currency: ${shopInfo.currencyCode}`);
    
  } catch (error) {
    console.log(`❌ Connection failed: ${error.message}`);
  }
}

// Kør test
testShopifyConnection();