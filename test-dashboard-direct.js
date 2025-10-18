// Test Dashboard API directly
const API_KEY = '@Za#SJxn;gnBxJ;Iu2uixoUd&#\'ndl';
const API_BASE = 'https://shopify-analytics-nu.vercel.app/api';

async function testDashboard() {
  const startDate = '2024-10-15T22:00:00Z';  // Danish 16/10/2024 00:00
  const endDate = '2024-10-16T21:59:59Z';    // Danish 16/10/2024 23:59

  console.log('🔍 Testing Dashboard API...');
  console.log(`📅 Period: ${startDate} to ${endDate}`);

  const url = `${API_BASE}/analytics`;
  const payload = {
    startDate,
    endDate,
    type: 'dashboard-sku',
    apiKey: API_KEY
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error('API returned no data');
    }

    const daShop = result.data.find(shop => shop.shop.includes('pompdelux-da'));

    console.log('\n✅ DA Shop Results:');
    console.log('   Antal Ordrer:', daShop.antalOrdrer);
    console.log('   Bruttoomsætning:', daShop.bruttoomsætning);
    console.log('   Antal stk Brutto:', daShop.stkBrutto);
    console.log('   Antal stk Netto:', daShop.stkNetto);

    console.log('\n📊 All Shops:');
    result.data.forEach(shop => {
      const label = shop.shop.replace('pompdelux-', '').replace('.myshopify.com', '').toUpperCase();
      console.log(`   ${label}: ${shop.antalOrdrer} ordrer, ${shop.bruttoomsætning} DKK`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testDashboard();
