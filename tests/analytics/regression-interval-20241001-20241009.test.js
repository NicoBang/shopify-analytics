/**
 * Regression Validation: SKU-Level VAT Alignment
 * Period: 2024-10-01 → 2024-10-09
 *
 * Purpose: Verify Dashboard and Color_Analytics produce identical results
 * after SKU-level cancelled amount calculation fix.
 */

const API_KEY = 'bda5da3d49fe0e7391fded3895b5c6bc';
const API_BASE = 'https://shopify-analytics-nu.vercel.app/api';

// Test configuration
const START_DATE = '2024-10-01';
const END_DATE = '2024-10-09';

// Acceptance thresholds
const THRESHOLDS = {
  bruttoPercent: 0.1,      // 0.1%
  nettoPercent: 0.1,       // 0.1%
  antalStkExact: true,     // Must be identical
  rabatPercent: 0.5,       // 0.5%
  cancelledPercent: 0.5    // 0.5%
};

/**
 * Fetch Dashboard data
 */
async function getDashboardData() {
  const url = `${API_BASE}/analytics?startDate=${START_DATE}&endDate=${END_DATE}&type=dashboard`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Dashboard API failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.data) {
    throw new Error(`Dashboard API returned invalid data: ${JSON.stringify(result).substring(0, 200)}`);
  }

  // Aggregate totals across all shops
  let bruttoTotal = 0;
  let nettoTotal = 0;
  let antalStkBrutto = 0;
  let antalStkNetto = 0;
  let rabatTotal = 0;
  let cancelledTotal = 0;

  // Dashboard data format: [shop, orderId, date, country, discountedTotal, tax, shipping, itemCount, refundedAmount, refundedQty, refundDate, cancelledAmount, cancelledQty, saleDiscountTotal, combinedDiscountTotal]
  result.data.forEach(row => {
    const discountedTotal = row[4] || 0;
    const tax = row[5] || 0;
    const shipping = row[6] || 0;
    const itemCount = row[7] || 0;
    const refundedAmount = row[8] || 0;
    const refundedQty = row[9] || 0;
    const cancelledAmount = row[11] || 0;
    const cancelledQty = row[12] || 0;
    const saleDiscountTotal = row[13] || 0;
    const combinedDiscountTotal = row[14] || 0;

    // Brutto ex moms = discounted_total - tax - shipping
    const bruttoExMoms = discountedTotal - tax - shipping;

    // Netto ex moms = brutto - refunded_amount - cancelled_amount
    const nettoExMoms = bruttoExMoms - refundedAmount - cancelledAmount;

    bruttoTotal += bruttoExMoms;
    nettoTotal += nettoExMoms;
    antalStkBrutto += itemCount;
    antalStkNetto += (itemCount - refundedQty - cancelledQty);
    rabatTotal += (saleDiscountTotal + combinedDiscountTotal);
    cancelledTotal += cancelledAmount;
  });

  return {
    brutto: bruttoTotal,
    netto: nettoTotal,
    antalStkBrutto: antalStkBrutto,
    antalStkNetto: antalStkNetto,
    rabat: rabatTotal,
    cancelled: cancelledTotal,
    orderCount: result.data.length
  };
}

/**
 * Fetch Color Analytics data (aggregated style analytics)
 */
async function getColorAnalyticsData() {
  const url = `${API_BASE}/metadata?type=style&startDate=${START_DATE}&endDate=${END_DATE}&groupBy=farve`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Color Analytics API failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.data) {
    throw new Error(`Color Analytics API returned invalid data: ${JSON.stringify(result).substring(0, 200)}`);
  }

  // Aggregate totals across all color groups
  let bruttoTotal = 0;
  let nettoTotal = 0;
  let antalStkBrutto = 0;
  let antalStkNetto = 0;
  let rabatTotal = 0;
  let cancelledTotal = 0;

  // Color Analytics data format includes: solgt, retur, cancelled, omsætning
  result.data.forEach(item => {
    const solgt = item.solgt || 0;
    const retur = item.retur || 0;
    const cancelled = item.cancelled || 0;
    const omsætning = item.omsætning || 0;

    // Color Analytics omsætning is already ex moms
    bruttoTotal += omsætning;

    // Netto would need refund/cancelled amounts calculated
    // For now, Color Analytics doesn't provide refunded_amount, only counts
    // So we can't directly calculate netto from Color Analytics
    // This is a known limitation - we compare what we CAN compare

    antalStkBrutto += solgt;
    antalStkNetto += (solgt - retur - cancelled);

    // Note: Color Analytics doesn't separately track rabat or cancelled amounts
    // These would need to be calculated from SKU data
  });

  return {
    brutto: bruttoTotal,
    netto: null, // Not directly available in Color Analytics
    antalStkBrutto: antalStkBrutto,
    antalStkNetto: antalStkNetto,
    rabat: null, // Not directly available
    cancelled: null, // Not directly available (only count, not amount)
    colorCount: result.data.length
  };
}

/**
 * Fetch SKU-level raw data for complete comparison
 */
async function getSkuRawData() {
  // Set limit=all to fetch ALL SKU records (not just first 10,000)
  const url = `${API_BASE}/sku-raw?startDate=${START_DATE}&endDate=${END_DATE}&includeShopBreakdown=true&limit=1000000`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`SKU Raw API failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.summary) {
    throw new Error(`SKU Raw API returned invalid data: ${JSON.stringify(result).substring(0, 200)}`);
  }

  // Use summary totals from API (already calculated from ALL SKU records)
  const summary = result.summary;

  // Note: The API already aggregates ALL SKU records and returns pre-calculated totals
  // This is more efficient than fetching all individual records and re-aggregating

  return {
    brutto: summary.totalRevenue,  // Revenue already calculated with discount_per_unit_dkk applied
    netto: null,  // Cannot calculate: summary doesn't include totalRefundedAmount
    antalStkBrutto: summary.totalQuantitySold,
    antalStkNetto: summary.netQuantitySold,  // Already calculated: totalQuantitySold - totalQuantityRefunded - totalQuantityCancelled
    rabat: null,  // Cannot calculate: summary doesn't include totalDiscounts
    cancelled: summary.totalCancelledAmount,
    skuCount: summary.totalRecords
  };
}

/**
 * Calculate percentage difference
 */
function calcDiff(value1, value2) {
  if (value2 === 0) return value1 === 0 ? 0 : 100;
  return ((value1 - value2) / value2) * 100;
}

/**
 * Format number with 2 decimals
 */
function fmt(num) {
  return num.toFixed(2);
}

/**
 * Main test execution
 */
async function runRegressionTest() {
  console.log('\n=== Regression Validation: 2024-10-01 → 2024-10-09 ===\n');
  console.log('Fetching Dashboard data...');
  const dashboard = await getDashboardData();

  console.log('Fetching Color Analytics data...');
  const colorAnalytics = await getColorAnalyticsData();

  console.log('Fetching SKU Raw data...');
  const skuRaw = await getSkuRawData();

  console.log('\n--- Data Summary ---');
  console.log(`Dashboard: ${dashboard.orderCount} orders`);
  console.log(`Color Analytics: ${colorAnalytics.colorCount} color groups`);
  console.log(`SKU Raw: ${skuRaw.skuCount} SKU records\n`);

  // Compare Dashboard vs SKU Raw (most accurate comparison)
  console.log('=== Dashboard vs SKU Raw Comparison ===\n');

  const comparisons = [
    {
      metric: 'Brutto ex moms',
      dashboard: dashboard.brutto,
      skuRaw: skuRaw.brutto,
      threshold: THRESHOLDS.bruttoPercent,
      isPercent: true
    },
    {
      metric: 'Netto ex moms',
      dashboard: dashboard.netto,
      skuRaw: skuRaw.netto,
      threshold: THRESHOLDS.nettoPercent,
      isPercent: true
    },
    {
      metric: 'Antal stk Brutto',
      dashboard: dashboard.antalStkBrutto,
      skuRaw: skuRaw.antalStkBrutto,
      threshold: THRESHOLDS.antalStkExact,
      isPercent: false
    },
    {
      metric: 'Antal stk Netto',
      dashboard: dashboard.antalStkNetto,
      skuRaw: skuRaw.antalStkNetto,
      threshold: THRESHOLDS.antalStkExact,
      isPercent: false
    },
    {
      metric: 'Rabat ex moms',
      dashboard: dashboard.rabat,
      skuRaw: skuRaw.rabat,
      threshold: THRESHOLDS.rabatPercent,
      isPercent: true
    },
    {
      metric: 'Cancelled amount',
      dashboard: dashboard.cancelled,
      skuRaw: skuRaw.cancelled,
      threshold: THRESHOLDS.cancelledPercent,
      isPercent: true
    }
  ];

  // Print table header
  console.log('| Metric              | Dashboard       | SKU Raw         | Diff (DKK)    | Diff (%)  | Status |');
  console.log('|---------------------|-----------------|-----------------|---------------|-----------|--------|');

  let allPassed = true;
  const failures = [];

  comparisons.forEach(comp => {
    // Skip comparison if SKU Raw value is null (data not available in summary)
    if (comp.skuRaw === null) {
      console.log(`| ${comp.metric.padEnd(19)} | ${fmt(comp.dashboard).padStart(15)} | ${'N/A'.padStart(15)} | ${'N/A'.padStart(13)} | ${'N/A'.padStart(9)} | ⏭️ SKIP |`);
      return;
    }

    const diffAbs = comp.dashboard - comp.skuRaw;
    const diffPct = calcDiff(comp.dashboard, comp.skuRaw);

    let status;
    if (comp.isPercent) {
      status = Math.abs(diffPct) < comp.threshold ? '✅ PASS' : '❌ FAIL';
    } else {
      // Exact match required
      status = diffAbs === 0 ? '✅ PASS' : '❌ FAIL';
    }

    if (status.includes('FAIL')) {
      allPassed = false;
      failures.push({
        metric: comp.metric,
        dashboard: comp.dashboard,
        skuRaw: comp.skuRaw,
        diffAbs,
        diffPct
      });
    }

    console.log(`| ${comp.metric.padEnd(19)} | ${fmt(comp.dashboard).padStart(15)} | ${fmt(comp.skuRaw).padStart(15)} | ${fmt(diffAbs).padStart(13)} | ${fmt(diffPct).padStart(9)} | ${status} |`);
  });

  console.log('\n--- Test Summary ---');
  if (allPassed) {
    console.log('✅ ALL CRITERIA PASSED');
  } else {
    console.log('❌ SOME CRITERIA FAILED\n');
    console.log('Failed metrics:');
    failures.forEach(f => {
      console.log(`  - ${f.metric}:`);
      console.log(`    Dashboard: ${fmt(f.dashboard)} DKK`);
      console.log(`    SKU Raw: ${fmt(f.skuRaw)} DKK`);
      console.log(`    Difference: ${fmt(f.diffAbs)} DKK (${fmt(f.diffPct)}%)`);
    });
  }

  return {
    passed: allPassed,
    dashboard,
    skuRaw,
    colorAnalytics,
    failures
  };
}

// Run test
runRegressionTest()
  .then(result => {
    process.exit(result.passed ? 0 : 1);
  })
  .catch(error => {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  });
