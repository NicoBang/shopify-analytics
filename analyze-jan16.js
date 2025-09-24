// analyze-jan16.js - Direct analysis of Jan 16 data
const axios = require('axios');

async function analyzeJan16() {
  console.log('🔍 Fetching data for Jan 16, 2025...\n');

  try {
    const response = await axios.get(
      'https://shopify-analytics-byns53dzs-nicolais-projects-291e9559.vercel.app/api/sku-raw',
      {
        params: {
          startDate: '2025-01-16',
          endDate: '2025-01-16',
          limit: 1000
        },
        headers: {
          'Authorization': 'Bearer bda5da3d49fe0e7391fded3895b5c6bc'
        }
      }
    );

    const data = response.data;
    console.log(`📊 API Response Summary:`);
    console.log(`   Total Records (from summary): ${data.summary?.totalRecords}`);
    console.log(`   Unique SKUs: ${data.summary?.uniqueSkus}`);
    console.log(`   Total Quantity Sold: ${data.summary?.totalQuantitySold}`);
    console.log(`   Total Refunded: ${data.summary?.totalQuantityRefunded}`);

    const records = data.data || [];
    console.log(`\n📦 Actual data analysis:`);
    console.log(`   Records returned: ${records.length}`);

    // Check for duplicates
    const seen = new Map();
    const duplicates = [];

    records.forEach(record => {
      const key = `${record.shop}-${record.order_id}-${record.sku}`;
      if (seen.has(key)) {
        duplicates.push({
          key,
          existing: seen.get(key),
          duplicate: record
        });
      } else {
        seen.set(key, record);
      }
    });

    console.log(`   Unique combinations: ${seen.size}`);
    console.log(`   Duplicates found: ${duplicates.length}`);

    if (duplicates.length > 0) {
      console.log('\n❌ Sample duplicates:');
      duplicates.slice(0, 3).forEach((dup, i) => {
        console.log(`\n   Duplicate ${i + 1}:`);
        console.log(`   Key: ${dup.key}`);
        console.log(`   Record 1 - ID: ${dup.existing.id}, Refund: ${dup.existing.refund_date || 'none'}`);
        console.log(`   Record 2 - ID: ${dup.duplicate.id}, Refund: ${dup.duplicate.refund_date || 'none'}`);
      });
    }

    // Analyze artikel 20204
    const artikel20204 = records.filter(r => r.sku?.startsWith('20204'));
    console.log(`\n📦 Artikel 20204 analysis:`);
    console.log(`   Records found: ${artikel20204.length}`);

    if (artikel20204.length > 0) {
      const totalQty = artikel20204.reduce((sum, r) => sum + (r.quantity || 0), 0);
      const totalRefunded = artikel20204.reduce((sum, r) => sum + (r.refunded_qty || 0), 0);
      console.log(`   Total quantity: ${totalQty}`);
      console.log(`   Total refunded: ${totalRefunded}`);
      console.log(`   Net sold: ${totalQty - totalRefunded} (should be 3)`);

      // Check for duplicates in 20204
      const seen20204 = new Set();
      const dup20204 = [];
      artikel20204.forEach(r => {
        const key = `${r.shop}-${r.order_id}-${r.sku}`;
        if (seen20204.has(key)) {
          dup20204.push(r);
        } else {
          seen20204.add(key);
        }
      });

      if (dup20204.length > 0) {
        console.log(`   ⚠️ Duplicates in 20204: ${dup20204.length}`);
      }
    }

    console.log('\n📊 Comparison:');
    console.log('   SQL COUNT shows: 726');
    console.log('   Table Editor shows: 364');
    console.log(`   API returns: ${records.length}`);
    console.log(`   Unique combinations: ${seen.size}`);

    if (records.length === 726 && seen.size === 363) {
      console.log('\n✅ Mystery solved: Database has exact duplicates!');
      console.log('   Every record appears exactly twice');
      console.log('   Need to run final cleanup to remove these duplicates');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

analyzeJan16();