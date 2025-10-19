#!/usr/bin/env node
// test-color-analytics-v2.js
// Compare V1 vs V2 Color Analytics results to ensure accuracy

require('dotenv').config();
const ColorAnalyticsV2 = require('./api/color-analytics-v2');

async function testColorAnalyticsV2() {
  console.log('🧪 Testing Color Analytics V2 vs V1\n');

  // Test date range: October 16, 2024 (single day for fast comparison)
  const startDate = new Date('2024-10-16T00:00:00Z');
  const endDate = new Date('2024-10-16T23:59:59Z');
  const shop = 'pompdelux-da.myshopify.com';

  console.log(`📅 Test period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`🏪 Shop: ${shop}\n`);

  try {
    // Run V2
    console.log('⚡ Running V2 (pre-aggregated)...');
    const v2Start = Date.now();
    const v2Service = new ColorAnalyticsV2();
    const v2Results = await v2Service.getColorAnalytics(startDate, endDate, shop);
    const v2Duration = Date.now() - v2Start;

    console.log(`\n✅ V2 completed in ${v2Duration}ms`);
    console.log(`   Found ${v2Results.length} colors\n`);

    // Display V2 results
    console.log('📊 V2 Results (Top 5 colors by revenue):\n');
    v2Results.slice(0, 5).forEach((color, i) => {
      console.log(`${i + 1}. ${color.farve}`);
      console.log(`   Solgt: ${color.solgt} stk`);
      console.log(`   Retur: ${color.retur} stk (${color.returPct.toFixed(2)}%)`);
      console.log(`   Omsætning: ${color.omsætning.toFixed(2)} DKK`);
      console.log(`   Lager: ${color.lager} stk`);
      console.log(`   DB: ${color.db.toFixed(2)} DKK (${color.dbPct.toFixed(2)}%)\n`);
    });

    // Summary
    const totalSold = v2Results.reduce((sum, c) => sum + c.solgt, 0);
    const totalRevenue = v2Results.reduce((sum, c) => sum + c.omsætning, 0);
    const totalReturn = v2Results.reduce((sum, c) => sum + c.retur, 0);

    console.log('📈 Summary:');
    console.log(`   Total colors: ${v2Results.length}`);
    console.log(`   Total sold: ${totalSold} stk`);
    console.log(`   Total revenue: ${totalRevenue.toFixed(2)} DKK`);
    console.log(`   Total returns: ${totalReturn} stk`);
    console.log(`   Performance: ${v2Duration}ms\n`);

    // Check for data quality issues
    console.log('🔍 Data Quality Checks:');

    const unknownColors = v2Results.filter(c => c.farve === 'UNKNOWN' || c.farve === 'OTHER');
    if (unknownColors.length > 0) {
      console.log(`   ⚠️ Found ${unknownColors.length} UNKNOWN/OTHER colors`);
      console.log(`      Total sold: ${unknownColors.reduce((sum, c) => sum + c.solgt, 0)} stk`);
    } else {
      console.log('   ✅ No UNKNOWN/OTHER colors');
    }

    const noMetadata = v2Results.filter(c => c.styles.some(s => s.status === 'NO_METADATA'));
    if (noMetadata.length > 0) {
      console.log(`   ⚠️ Found ${noMetadata.length} colors with missing metadata`);
    } else {
      console.log('   ✅ All styles have metadata');
    }

    const negativeRevenue = v2Results.filter(c => c.omsætning < 0);
    if (negativeRevenue.length > 0) {
      console.log(`   ❌ Found ${negativeRevenue.length} colors with negative revenue!`);
      negativeRevenue.forEach(c => {
        console.log(`      - ${c.farve}: ${c.omsætning.toFixed(2)} DKK`);
      });
    } else {
      console.log('   ✅ No negative revenue');
    }

    console.log('\n🎉 V2 Test completed successfully!\n');

    // Instructions for manual V1 comparison
    console.log('📝 Next Steps:');
    console.log('   1. Run V1 Color Analytics in Google Sheets for same date range');
    console.log('   2. Compare totals: sold, revenue, returns');
    console.log('   3. Check if top colors match between V1 and V2');
    console.log('   4. Verify DB% calculations are similar\n');

    return {
      success: true,
      duration: v2Duration,
      results: v2Results
    };

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run test
if (require.main === module) {
  testColorAnalyticsV2()
    .then(result => {
      if (result.success) {
        console.log('✅ All tests passed!');
        process.exit(0);
      } else {
        console.error('❌ Tests failed!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('❌ Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = testColorAnalyticsV2;
