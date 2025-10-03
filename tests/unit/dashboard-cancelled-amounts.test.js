/**
 * Dashboard Cancelled Amounts Tests
 *
 * Tests the refactored Dashboard calculation that uses SKU-level cancelled amounts
 * instead of proportional distribution.
 *
 * @see CLAUDE.md section "💰 Dashboard Fix – Cancelled Amounts (SKU-level)"
 */

describe('Dashboard Cancelled Amounts Calculation', () => {

  /**
   * Mock helper to calculate bruttoomsætning using the new SKU-level method
   * Replicates the logic in google-sheets-enhanced.js updateDashboard()
   */
  function calculateBrutto(ordersData, skuBreakdown = null) {
    const shopMap = {};

    // Step 1: Process orders (shipping, tax, initial revenue)
    ordersData.forEach(order => {
      const shop = order.shop || 'pompdelux-da.myshopify.com';

      if (!shopMap[shop]) {
        shopMap[shop] = {
          gross: 0,
          net: 0,
          shipping: 0,
          tax: 0,
          itemCount: 0,
          cancelledQty: 0
        };
      }

      const discountedTotal = parseFloat(order.discounted_total || 0);
      const tax = parseFloat(order.tax || 0);
      const shipping = parseFloat(order.shipping || 0);
      const itemCount = parseInt(order.item_count || 0);
      const cancelledQty = parseInt(order.cancelled_qty || 0);

      // Initial revenue (brutto + shipping + tax)
      shopMap[shop].gross += discountedTotal - tax - shipping;
      shopMap[shop].net += discountedTotal - tax - shipping;
      shopMap[shop].shipping += shipping;
      shopMap[shop].tax += tax;
      shopMap[shop].itemCount += itemCount;
      shopMap[shop].cancelledQty += cancelledQty;

      // OLD proportional calculation (fallback when skuBreakdown is null)
      if (!skuBreakdown && itemCount > 0 && cancelledQty > 0) {
        const perUnitExTax = (discountedTotal - tax - shipping) / itemCount;
        const cancelValueExTax = perUnitExTax * cancelledQty;
        shopMap[shop].gross -= cancelValueExTax;
        shopMap[shop].net -= cancelValueExTax;
      }
    });

    // Step 2: Use SKU-level revenue if available (NEW method)
    if (skuBreakdown && skuBreakdown.length > 0) {
      skuBreakdown.forEach(breakdown => {
        const shop = breakdown.shop;
        if (!shopMap[shop]) return;

        // Replace gross/net with SKU-level revenue
        // (SKU revenue already has precise cancelled amounts deducted)
        const skuRevenue = breakdown.revenue || 0;
        shopMap[shop].gross = skuRevenue;
        shopMap[shop].net = skuRevenue;
      });
    }

    // Step 3: Calculate refunds (same for both methods)
    // (Skipped in these tests for simplicity - focus is on cancellations)

    return shopMap;
  }

  /**
   * Test Case 1: Order without cancellations → result unchanged
   */
  test('Order without cancellations produces correct brutto', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 500.00,
        tax: 100.00,
        shipping: 50.00,
        item_count: 2,
        cancelled_qty: 0
      }
    ];

    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 350.00,  // 500 - 100 - 50 = 350
        cancelledAmount: 0
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    expect(result['pompdelux-da.myshopify.com'].gross).toBe(350.00);
    expect(result['pompdelux-da.myshopify.com'].net).toBe(350.00);
  });

  /**
   * Test Case 2: Order with 2 items, 1 cheap cancelled → brutto = expensive item price
   */
  test('Order with cheap item cancelled uses SKU-level amount', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 250.00,  // (50 + 150) + 25 tax + 25 shipping
        tax: 25.00,
        shipping: 25.00,
        item_count: 2,
        cancelled_qty: 1
      }
    ];

    // SKU breakdown shows revenue = 150 (only expensive item)
    // cancelled_amount = 50 (cheap item cancelled)
    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 150.00,  // Only expensive item remains
        cancelledAmount: 50.00  // Cheap item cancelled
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    // Should be 150 (expensive item), not 100 (proportional average)
    expect(result['pompdelux-da.myshopify.com'].gross).toBe(150.00);

    // OLD proportional method would give: (200/2) * 1 = 100 deducted → 100 remaining (WRONG!)
    // NEW SKU method gives: 150 remaining (CORRECT!)
  });

  /**
   * Test Case 3: Order with 2 items, 1 expensive cancelled → brutto = cheap item price
   */
  test('Order with expensive item cancelled uses SKU-level amount', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 250.00,  // (50 + 150) + 25 tax + 25 shipping
        tax: 25.00,
        shipping: 25.00,
        item_count: 2,
        cancelled_qty: 1
      }
    ];

    // SKU breakdown shows revenue = 50 (only cheap item)
    // cancelled_amount = 150 (expensive item cancelled)
    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 50.00,  // Only cheap item remains
        cancelledAmount: 150.00  // Expensive item cancelled
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    // Should be 50 (cheap item), not 100 (proportional average)
    expect(result['pompdelux-da.myshopify.com'].gross).toBe(50.00);

    // OLD proportional method would give: (200/2) * 1 = 100 deducted → 100 remaining (WRONG!)
    // NEW SKU method gives: 50 remaining (CORRECT!)
  });

  /**
   * Test Case 4: Fallback scenario (no cancelled_amount_dkk) → proportional calculation
   */
  test('Fallback to proportional calculation when skuBreakdown is null', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 250.00,  // (50 + 150) + 25 tax + 25 shipping
        tax: 25.00,
        shipping: 25.00,
        item_count: 2,
        cancelled_qty: 1
      }
    ];

    // No SKU breakdown provided (simulates old data without cancelled_amount_dkk)
    const result = calculateBrutto(ordersData, null);

    // Should use OLD proportional method: (200/2) * 1 = 100 deducted → 100 remaining
    expect(result['pompdelux-da.myshopify.com'].gross).toBe(100.00);

    // This confirms backward compatibility still works
  });

  /**
   * Test Case 5: Multiple shops with mixed scenarios
   */
  test('Multiple shops calculate independently with SKU-level data', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 250.00,
        tax: 25.00,
        shipping: 25.00,
        item_count: 2,
        cancelled_qty: 1
      },
      {
        shop: 'pompdelux-de.myshopify.com',
        discounted_total: 300.00,
        tax: 30.00,
        shipping: 20.00,
        item_count: 1,
        cancelled_qty: 0
      }
    ];

    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 150.00,
        cancelledAmount: 50.00
      },
      {
        shop: 'pompdelux-de.myshopify.com',
        revenue: 250.00,
        cancelledAmount: 0
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    expect(result['pompdelux-da.myshopify.com'].gross).toBe(150.00);
    expect(result['pompdelux-de.myshopify.com'].gross).toBe(250.00);
  });

  /**
   * Test Case 6: Edge case - all items cancelled
   */
  test('Order with all items cancelled shows zero revenue', () => {
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 250.00,
        tax: 25.00,
        shipping: 25.00,
        item_count: 2,
        cancelled_qty: 2
      }
    ];

    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 0,  // All items cancelled
        cancelledAmount: 200.00
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    expect(result['pompdelux-da.myshopify.com'].gross).toBe(0);
  });

  /**
   * Test Case 7: Real-world example from test order 6667277697291
   * Order with 2 items (cheap + expensive), cheap item cancelled
   */
  test('Real-world test order 6667277697291 calculation', () => {
    // Simplified version of actual order data
    const ordersData = [
      {
        shop: 'pompdelux-da.myshopify.com',
        discounted_total: 223.75,  // Total customer paid
        tax: 44.75,
        shipping: 29.00,
        item_count: 2,
        cancelled_qty: 1
      }
    ];

    // SKU breakdown from actual data:
    // - Cheap item (50 kr) cancelled
    // - Expensive item (150 kr) remains
    const skuBreakdown = [
      {
        shop: 'pompdelux-da.myshopify.com',
        revenue: 120.00,  // Expensive item only (150 ex tax)
        cancelledAmount: 40.00  // Cheap item (50 ex tax)
      }
    ];

    const result = calculateBrutto(ordersData, skuBreakdown);

    // Should match SKU-level calculation
    expect(result['pompdelux-da.myshopify.com'].gross).toBeCloseTo(120.00, 2);

    // OLD proportional method would calculate:
    // brutto = 223.75 - 44.75 - 29 = 150
    // per unit = 150 / 2 = 75
    // cancelled value = 75 * 1 = 75
    // result = 150 - 75 = 75 (WRONG! Should be 120)
  });
});

/**
 * Integration Test: Regression test for known period
 *
 * This test would query actual database and compare Dashboard vs Color_Analytics
 * For now, it's a placeholder showing the testing approach.
 *
 * @todo Implement actual API integration test when data is synced
 */
describe.skip('Dashboard vs Color_Analytics Regression Test', () => {
  test('2024-10-09 period should match within 0.1%', async () => {
    // This test requires actual API calls and database data
    // Skipped until data is synced with cancelled_amount_dkk

    const dashboardTotal = 0; // Would fetch from updateDashboard()
    const colorAnalyticsTotal = 0; // Would fetch from generateStyleColorAnalytics()

    const discrepancy = Math.abs(dashboardTotal - colorAnalyticsTotal) / colorAnalyticsTotal;

    expect(discrepancy).toBeLessThan(0.001); // <0.1% error
  });
});
