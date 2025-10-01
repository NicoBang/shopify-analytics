// Test to sync just 1 product and see what metadata we get

const API_KEY = 'bda5da3d49fe0e7391fded3895b5c6bc';
const API_BASE = 'https://shopify-analytics-qlxndv2am-nicolais-projects-291e9559.vercel.app/api';

async function testSingleProduct() {
  // First fetch a sample SKU from existing data
  const skuResponse = await fetch(`${API_BASE}/metadata?type=list&limit=1`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  const skuData = await skuResponse.json();
  console.log('Sample SKU from database:', JSON.stringify(skuData, null, 2));

  // Now sync metadata (which fetches from Shopify)
  console.log('\n🔄 Syncing metadata from Shopify...');
  const syncResponse = await fetch(`${API_BASE}/sync-shop?shop=pompdelux-da.myshopify.com&type=metadata`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  const syncData = await syncResponse.json();
  console.log('\n✅ Sync result:', JSON.stringify(syncData, null, 2));

  // Check database again
  console.log('\n📊 Checking database after sync...');
  const checkResponse = await fetch(`${API_BASE}/metadata?type=list&limit=3`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  const checkData = await checkResponse.json();
  console.log('Database after sync:', JSON.stringify(checkData, null, 2));
}

testSingleProduct().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});