// src/test-config.js
const { CONFIG } = require('./config');

console.log('🔍 Testing configuration...\n');

// Test at shops er loaded
console.log(`✅ Loaded ${CONFIG.SHOPS.length} shops:`);
CONFIG.SHOPS.forEach(shop => {
  const hasToken = shop.token ? '✅ Token found' : '❌ TOKEN MISSING!';
  console.log(`   - ${shop.domain}: ${hasToken}`);
});

// Test andre config værdier
console.log(`\n📅 Cutoff date: ${CONFIG.CUTOFF_DATE.toISOString().split('T')[0]}`);
console.log(`📦 Max orders per page: ${CONFIG.MAX_ORDERS_PER_PAGE}`);
console.log(`🔄 API Version: ${CONFIG.API_VERSION}`);