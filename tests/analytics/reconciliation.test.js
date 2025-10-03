/**
 * Analytics Reconciliation Test
 *
 * Formål: Automatisk sammenligning af beregninger mellem Dashboard og Color_Analytics
 * for at sikre datakonsistens og opdage divergens tidligt.
 *
 * Testkrav:
 * - Bruttoomsætning: Difference ≤ 0,1%
 * - Antal stk Brutto: Skal matche 100% (ingen tolerance)
 * - Returer: Difference ≤ 1 stk (tolerance for edge-cases)
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://shopify-analytics-nu.vercel.app/api';
const API_KEY = process.env.API_SECRET_KEY || 'bda5da3d49fe0e7391fded3895b5c6bc';

// Test periods
const TEST_PERIODS = {
  SINGLE_DAY: {
    startDate: '2024-10-09',
    endDate: '2024-10-09',
    description: 'Single day with known discrepancy'
  },
  WEEK: {
    startDate: '2024-10-01',
    endDate: '2024-10-09',
    description: 'Week period with multiple orders'
  },
  MONTH: {
    startDate: '2024-10-01',
    endDate: '2024-10-31',
    description: 'Full month regression test'
  },
  EMPTY: {
    startDate: '2023-01-01',
    endDate: '2023-01-01',
    description: 'Empty period (no orders expected)'
  }
};

// Tolerance thresholds
const TOLERANCE = {
  REVENUE_PERCENT: 0.1,  // 0.1% max difference
  QUANTITY: 0,           // Must match exactly
  RETURNS: 1             // Max 1 unit difference
};

/**
 * Helper: Fetch Dashboard data
 */
async function fetchDashboardData(startDate, endDate) {
  const response = await axios.get(`${API_BASE_URL}/analytics`, {
    params: { startDate, endDate, type: 'dashboard' },
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!response.data.success) {
    throw new Error(`Dashboard API failed: ${response.data.error}`);
  }

  return response.data.data;
}

/**
 * Helper: Calculate Dashboard totals
 * Replicates logic from google-sheets-enhanced.js:130-175
 */
function calculateDashboardTotals(orders) {
  const totals = {
    bruttoomsætning: 0,
    antalStkBrutto: 0,
    antalStkNetto: 0,
    retur: 0
  };

  orders.forEach(order => {
    const discountedTotal = order.discounted_total || 0;
    const tax = order.tax || 0;
    const shipping = order.shipping || 0;
    const itemCount = order.item_count || 0;
    const cancelledQty = order.cancelled_qty || 0;
    const refundedQty = order.refunded_qty || 0;
    const refundDate = order.refund_date;

    // Calculate base brutto
    let brutto = discountedTotal - tax - shipping;

    // Calculate brutto quantity
    const bruttoQty = Math.max(0, itemCount - cancelledQty);
    totals.antalStkBrutto += bruttoQty;

    // Proportional cancellation subtraction (the problematic code)
    if (itemCount > 0 && cancelledQty > 0) {
      const perUnitExTax = brutto / itemCount;
      const cancelValueExTax = perUnitExTax * cancelledQty;
      brutto -= cancelValueExTax;
    }

    totals.bruttoomsætning += brutto;

    // Calculate netto (after refunds)
    if (refundDate) {
      totals.antalStkNetto += (bruttoQty - refundedQty);
    } else {
      totals.antalStkNetto += bruttoQty;
    }
  });

  // Calculate retur as difference between brutto and netto
  totals.retur = totals.antalStkBrutto - totals.antalStkNetto;

  return totals;
}

/**
 * Helper: Fetch Color_Analytics data
 */
async function fetchColorAnalyticsData(startDate, endDate) {
  const response = await axios.get(`${API_BASE_URL}/metadata`, {
    params: {
      type: 'style',
      startDate,
      endDate,
      groupBy: 'farve'
    },
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!response.data.success) {
    throw new Error(`Color_Analytics API failed: ${response.data.error}`);
  }

  return response.data.data;
}

/**
 * Helper: Calculate Color_Analytics totals
 */
function calculateColorAnalyticsTotals(colorGroups) {
  const totals = {
    bruttoomsætning: 0,
    antalStkBrutto: 0,
    retur: 0
  };

  colorGroups.forEach(group => {
    totals.bruttoomsætning += (group.omsætning || 0);
    totals.antalStkBrutto += (group.solgt || 0);
    totals.retur += (group.retur || 0);
  });

  return totals;
}

/**
 * Helper: Calculate percentage difference
 */
function percentDifference(value1, value2) {
  if (value1 === 0 && value2 === 0) return 0;
  if (value1 === 0) return 100;
  return Math.abs((value1 - value2) / value1 * 100);
}

/**
 * Helper: Format test result message
 */
function formatMismatch(metric, dashboard, colorAnalytics, diff, tolerance) {
  return `
Mismatch in ${metric}:
  Dashboard: ${dashboard.toLocaleString('da-DK', { minimumFractionDigits: 2 })}
  Color_Analytics: ${colorAnalytics.toLocaleString('da-DK', { minimumFractionDigits: 2 })}
  Difference: ${diff.toLocaleString('da-DK', { minimumFractionDigits: 2 })}
  Tolerance: ${tolerance}
`;
}

/**
 * Test Suite: Dashboard vs Color_Analytics Reconciliation
 */
describe('Dashboard vs Color_Analytics Reconciliation', () => {

  // Test 1: Known discrepancy day (2024-10-09)
  describe('Known Test Period (2024-10-09)', () => {
    let dashboardTotals;
    let colorAnalyticsTotals;

    beforeAll(async () => {
      const period = TEST_PERIODS.SINGLE_DAY;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
      const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

      dashboardTotals = calculateDashboardTotals(dashboardOrders);
      colorAnalyticsTotals = calculateColorAnalyticsTotals(colorAnalyticsData);
    });

    test('should have known Dashboard bruttoomsætning (49,736.42 kr)', () => {
      expect(dashboardTotals.bruttoomsætning).toBeCloseTo(49736.42, 2);
    });

    test('should have known Color_Analytics bruttoomsætning (45,205.35 kr)', () => {
      expect(colorAnalyticsTotals.bruttoomsætning).toBeCloseTo(45205.35, 2);
    });

    test('should detect known discrepancy in bruttoomsætning (9.1%)', () => {
      const diff = percentDifference(
        dashboardTotals.bruttoomsætning,
        colorAnalyticsTotals.bruttoomsætning
      );

      // This test should FAIL because we know there's a 9.1% difference
      // This demonstrates the test catches the known issue
      expect(diff).toBeGreaterThan(TOLERANCE.REVENUE_PERCENT);
      expect(diff).toBeCloseTo(9.1, 0);
    });

    test('antal stk brutto should match perfectly (250 stk)', () => {
      expect(dashboardTotals.antalStkBrutto).toBe(250);
      expect(colorAnalyticsTotals.antalStkBrutto).toBe(250);
      expect(dashboardTotals.antalStkBrutto).toBe(colorAnalyticsTotals.antalStkBrutto);
    });
  });

  // Test 2: Week period reconciliation
  describe('Week Period (2024-10-01 to 2024-10-09)', () => {
    let dashboardTotals;
    let colorAnalyticsTotals;

    beforeAll(async () => {
      const period = TEST_PERIODS.WEEK;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
      const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

      dashboardTotals = calculateDashboardTotals(dashboardOrders);
      colorAnalyticsTotals = calculateColorAnalyticsTotals(colorAnalyticsData);
    });

    test('bruttoomsætning should be within tolerance', () => {
      const diff = percentDifference(
        dashboardTotals.bruttoomsætning,
        colorAnalyticsTotals.bruttoomsætning
      );

      if (diff > TOLERANCE.REVENUE_PERCENT) {
        const message = formatMismatch(
          'bruttoomsætning',
          dashboardTotals.bruttoomsætning,
          colorAnalyticsTotals.bruttoomsætning,
          diff,
          `${TOLERANCE.REVENUE_PERCENT}%`
        );
        fail(message);
      }

      expect(diff).toBeLessThanOrEqual(TOLERANCE.REVENUE_PERCENT);
    });

    test('antal stk brutto should match exactly', () => {
      const diff = Math.abs(
        dashboardTotals.antalStkBrutto - colorAnalyticsTotals.antalStkBrutto
      );

      if (diff !== TOLERANCE.QUANTITY) {
        const message = formatMismatch(
          'antal stk brutto',
          dashboardTotals.antalStkBrutto,
          colorAnalyticsTotals.antalStkBrutto,
          diff,
          `${TOLERANCE.QUANTITY} stk`
        );
        fail(message);
      }

      expect(diff).toBe(TOLERANCE.QUANTITY);
    });

    test('returer should be within tolerance', () => {
      const diff = Math.abs(
        dashboardTotals.retur - colorAnalyticsTotals.retur
      );

      if (diff > TOLERANCE.RETURNS) {
        const message = formatMismatch(
          'returer',
          dashboardTotals.retur,
          colorAnalyticsTotals.retur,
          diff,
          `${TOLERANCE.RETURNS} stk`
        );
        fail(message);
      }

      expect(diff).toBeLessThanOrEqual(TOLERANCE.RETURNS);
    });
  });

  // Test 3: Full month regression test
  describe('Full Month Period (October 2024)', () => {
    let dashboardTotals;
    let colorAnalyticsTotals;

    beforeAll(async () => {
      const period = TEST_PERIODS.MONTH;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
      const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

      dashboardTotals = calculateDashboardTotals(dashboardOrders);
      colorAnalyticsTotals = calculateColorAnalyticsTotals(colorAnalyticsData);
    });

    test('bruttoomsætning should be within tolerance', () => {
      const diff = percentDifference(
        dashboardTotals.bruttoomsætning,
        colorAnalyticsTotals.bruttoomsætning
      );

      expect(diff).toBeLessThanOrEqual(TOLERANCE.REVENUE_PERCENT);
    });

    test('antal stk brutto should match exactly', () => {
      const diff = Math.abs(
        dashboardTotals.antalStkBrutto - colorAnalyticsTotals.antalStkBrutto
      );

      expect(diff).toBe(TOLERANCE.QUANTITY);
    });

    test('returer should be within tolerance', () => {
      const diff = Math.abs(
        dashboardTotals.retur - colorAnalyticsTotals.retur
      );

      expect(diff).toBeLessThanOrEqual(TOLERANCE.RETURNS);
    });
  });

  // Test 4: Edge case - Empty period
  describe('Edge Case: Empty Period', () => {
    let dashboardTotals;
    let colorAnalyticsTotals;

    beforeAll(async () => {
      const period = TEST_PERIODS.EMPTY;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
      const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

      dashboardTotals = calculateDashboardTotals(dashboardOrders);
      colorAnalyticsTotals = calculateColorAnalyticsTotals(colorAnalyticsData);
    });

    test('Dashboard should return zero for all metrics', () => {
      expect(dashboardTotals.bruttoomsætning).toBe(0);
      expect(dashboardTotals.antalStkBrutto).toBe(0);
      expect(dashboardTotals.retur).toBe(0);
    });

    test('Color_Analytics should return zero for all metrics', () => {
      expect(colorAnalyticsTotals.bruttoomsætning).toBe(0);
      expect(colorAnalyticsTotals.antalStkBrutto).toBe(0);
      expect(colorAnalyticsTotals.retur).toBe(0);
    });

    test('Both systems should match on empty period', () => {
      expect(dashboardTotals.bruttoomsætning).toBe(colorAnalyticsTotals.bruttoomsætning);
      expect(dashboardTotals.antalStkBrutto).toBe(colorAnalyticsTotals.antalStkBrutto);
      expect(dashboardTotals.retur).toBe(colorAnalyticsTotals.retur);
    });
  });

  // Test 5: Edge case - Order with partial cancellation
  describe('Edge Case: Order with Partial Cancellation', () => {
    test('should handle single order with cancellation correctly', async () => {
      // Test specific order: 6667277697291 (2 items, 1 cancelled)
      const period = TEST_PERIODS.SINGLE_DAY;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);

      // Find the test order
      const testOrder = dashboardOrders.find(o => o.order_id === '6667277697291');

      expect(testOrder).toBeDefined();
      expect(testOrder.item_count).toBe(2);
      expect(testOrder.cancelled_qty).toBe(1);

      // Calculate Dashboard value for this specific order
      const discountedTotal = testOrder.discounted_total;
      const tax = testOrder.tax;
      const shipping = testOrder.shipping;
      const itemCount = testOrder.item_count;
      const cancelledQty = testOrder.cancelled_qty;

      let brutto = discountedTotal - tax - shipping;

      // Proportional cancellation (Dashboard logic)
      const perUnitExTax = brutto / itemCount;
      const cancelValueExTax = perUnitExTax * cancelledQty;
      const dashboardBrutto = brutto - cancelValueExTax;

      // Expected Dashboard calculation
      expect(dashboardBrutto).toBeCloseTo(49.24, 2);

      // Note: SKU-level calculation would use actual prices
      // This test demonstrates the difference in methodology
    });
  });

  // Test 6: Performance check
  describe('Performance Check', () => {
    test('should complete reconciliation within 10 seconds', async () => {
      const startTime = Date.now();

      const period = TEST_PERIODS.MONTH;
      const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
      const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

      calculateDashboardTotals(dashboardOrders);
      calculateColorAnalyticsTotals(colorAnalyticsData);

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      expect(duration).toBeLessThan(10);
    }, 15000); // 15 second timeout
  });
});

/**
 * Test Suite: Known Issues Documentation
 */
describe('Known Issues (Expected Failures)', () => {
  test('Dashboard proportional cancellation causes 9.1% discrepancy', async () => {
    const period = TEST_PERIODS.SINGLE_DAY;
    const dashboardOrders = await fetchDashboardData(period.startDate, period.endDate);
    const colorAnalyticsData = await fetchColorAnalyticsData(period.startDate, period.endDate);

    const dashboardTotals = calculateDashboardTotals(dashboardOrders);
    const colorAnalyticsTotals = calculateColorAnalyticsTotals(colorAnalyticsData);

    const diff = percentDifference(
      dashboardTotals.bruttoomsætning,
      colorAnalyticsTotals.bruttoomsætning
    );

    // This documents the known issue
    expect(diff).toBeCloseTo(9.1, 0);

    console.log('\n📊 Known Issue Summary:');
    console.log(`  Dashboard: ${dashboardTotals.bruttoomsætning.toFixed(2)} kr (proportional method)`);
    console.log(`  Color_Analytics: ${colorAnalyticsTotals.bruttoomsætning.toFixed(2)} kr (SKU-level prices)`);
    console.log(`  Difference: ${diff.toFixed(1)}%`);
    console.log('\n  ⚠️ Dashboard uses mathematically incorrect proportional cancellation.');
    console.log('  ✅ Color_Analytics uses mathematically correct SKU-level prices.');
  });
});
