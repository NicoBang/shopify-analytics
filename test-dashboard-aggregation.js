// Test Dashboard API with pre-aggregated data

const apiKey = "@Za#SJxn;gnBxJ;Iu2uixoUd&#'ndl";

async function testDashboard(startDate, endDate, type = 'dashboard') {
  const url = `https://shopify-analytics-nu.vercel.app/api/analytics?startDate=${startDate}&endDate=${endDate}&type=${type}&apiKey=${encodeURIComponent(apiKey)}`;

  console.log(`\n🧪 Testing: ${type} for ${startDate} to ${endDate}`);
  console.log(`URL: ${url}`);

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error('❌ Error:', data.error);
    return;
  }

  console.log('\n📊 Results:');
  data.data?.forEach(shop => {
    console.log(`\n${shop.shop}:`);
    console.log(`  Orders: ${shop.antalOrdrer}`);
    console.log(`  Revenue Gross: ${shop.bruttoomsætning?.toFixed(2)} DKK`);
    console.log(`  Revenue Net: ${shop.nettoomsætning?.toFixed(2)} DKK`);
    console.log(`  Returns: ${shop.returQty} items (${shop.refundedAmount?.toFixed(2)} DKK)`);
    console.log(`  SKU Brutto: ${shop.stkBrutto}`);
    console.log(`  SKU Netto: ${shop.stkNetto}`);
  });

  console.log('\n⚙️ Meta:');
  console.log(`  Execution time: ${data.executionTimeMs}ms`);
  console.log(`  Total shops: ${data.data?.length}`);
}

(async () => {
  // Test 1: Default dashboard (real-time from SKUs)
  await testDashboard('2024-10-16', '2024-10-16', 'dashboard');

  // Test 2: Pre-aggregated dashboard
  await testDashboard('2024-10-16', '2024-10-16', 'dashboard-sku');
})();
