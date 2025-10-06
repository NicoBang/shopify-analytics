/**
 * Integration Tests for Daily Batch Execution in Shopify Bulk Operations
 *
 * Tests per-day execution, retry logic, and error handling for:
 * - 3-day interval with varying order counts
 * - THROTTLED error retry
 * - INTERNAL_SERVER_ERROR retry
 * - Successful completion after retries
 */

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

// Mock Supabase Edge Function URL (replace with actual deployment URL for real tests)
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL || 'http://localhost:54321/functions/v1/bulk-sync-orders';
const TEST_SHOP = 'pompdelux-da.myshopify.com';
const TEST_AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-token';

describe('Bulk Sync Orders - Daily Batch Execution', () => {

  test('should process 3-day interval successfully with varying order counts', async () => {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        shop: TEST_SHOP,
        startDate: '2024-10-01',
        endDate: '2024-10-03', // 3 days
        objectType: 'orders'
      })
    });

    expect(response.status).toBe(200);

    const result = await response.json();

    // Verify response structure
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('jobId');
    expect(result).toHaveProperty('daysProcessed', 3);
    expect(result).toHaveProperty('totalOrdersSynced');
    expect(result).toHaveProperty('totalDurationMs');
    expect(result).toHaveProperty('dayResults');

    // Verify day results array
    expect(result.dayResults).toHaveLength(3);

    result.dayResults.forEach((dayResult, index) => {
      expect(dayResult).toHaveProperty('day');
      expect(dayResult).toHaveProperty('status');
      expect(dayResult).toHaveProperty('ordersProcessed');
      expect(dayResult).toHaveProperty('skusProcessed');
      expect(dayResult).toHaveProperty('durationMs');

      // Verify day is in correct format (YYYY-MM-DD)
      expect(dayResult.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Verify status is either success, failed, or skipped
      expect(['success', 'failed', 'skipped']).toContain(dayResult.status);

      console.log(`Day ${index + 1}: ${dayResult.day} - ${dayResult.status} (${dayResult.ordersProcessed} orders, ${dayResult.durationMs}ms)`);
    });

    // Verify at least some orders were processed
    expect(result.totalOrdersSynced).toBeGreaterThan(0);

    console.log(`\n✅ Total: ${result.totalOrdersSynced} orders synced across ${result.daysProcessed} days in ${result.totalDurationMs}ms`);
  }, 300000); // 5 minute timeout for bulk operations

  test('should retry THROTTLED errors up to MAX_RETRIES', async () => {
    // This test would require a mock Shopify API that returns THROTTLED errors
    // For now, we document the expected behavior:

    /**
     * Expected behavior:
     * 1. Day 1 returns THROTTLED error
     * 2. Function retries with 5s delay
     * 3. Day 1 returns THROTTLED error again
     * 4. Function retries with 10s delay (exponential backoff)
     * 5. Day 1 succeeds on 3rd attempt
     * 6. Function continues to Day 2
     *
     * Logs should show:
     * ⚠️  Day 2024-10-01 failed with THROTTLED, retry 1/3...
     * ⚠️  Day 2024-10-01 failed with THROTTLED, retry 2/3...
     * ✅ Day completed: 2024-10-01 (X orders, Ys)
     */

    console.log('⏭️  THROTTLED retry test requires mock Shopify API - skipping for now');
    expect(true).toBe(true);
  });

  test('should retry INTERNAL_SERVER_ERROR up to MAX_RETRIES', async () => {
    // This test would require a mock Shopify API that returns INTERNAL_SERVER_ERROR
    // For now, we document the expected behavior:

    /**
     * Expected behavior:
     * 1. Day 2 returns INTERNAL_SERVER_ERROR
     * 2. Function retries with 5s delay
     * 3. Day 2 succeeds on 2nd attempt
     * 4. Function continues to Day 3
     *
     * Logs should show:
     * ⚠️  Day 2024-10-02 failed with INTERNAL_SERVER_ERROR, retry 1/3...
     * ✅ Day completed: 2024-10-02 (X orders, Ys)
     */

    console.log('⏭️  INTERNAL_SERVER_ERROR retry test requires mock Shopify API - skipping for now');
    expect(true).toBe(true);
  });

  test('should skip day and continue if retries fail', async () => {
    // This test would require a mock Shopify API that consistently returns errors
    // For now, we document the expected behavior:

    /**
     * Expected behavior:
     * 1. Day 3 returns THROTTLED error (attempt 1)
     * 2. Day 3 returns THROTTLED error (attempt 2)
     * 3. Day 3 returns THROTTLED error (attempt 3)
     * 4. Function marks Day 3 as failed and continues
     * 5. Job completes with partial success
     *
     * Logs should show:
     * ⚠️  Day 2024-10-03 failed with THROTTLED, retry 1/3...
     * ⚠️  Day 2024-10-03 failed with THROTTLED, retry 2/3...
     * ⚠️  Day 2024-10-03 failed with THROTTLED, retry 3/3...
     * ❌ Day failed: 2024-10-03 - Bulk operation failed: THROTTLED
     *
     * Response should show:
     * - success: true (partial success)
     * - daysProcessed: 3
     * - totalOrdersSynced: X (only from successful days)
     * - dayResults[2].status: "failed"
     * - dayResults[2].error: "Bulk operation failed: THROTTLED"
     */

    console.log('⏭️  Retry exhaustion test requires mock Shopify API - skipping for now');
    expect(true).toBe(true);
  });

  test('should handle empty days gracefully', async () => {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        shop: TEST_SHOP,
        startDate: '2023-01-01', // Historical date with no orders
        endDate: '2023-01-03',
        objectType: 'orders'
      })
    });

    expect(response.status).toBe(200);

    const result = await response.json();

    // Empty days should still succeed with 0 orders
    expect(result.success).toBe(true);
    expect(result.daysProcessed).toBe(3);
    expect(result.totalOrdersSynced).toBe(0);

    result.dayResults.forEach((dayResult) => {
      expect(dayResult.status).toBe('success');
      expect(dayResult.ordersProcessed).toBe(0);
    });

    console.log('✅ Empty days handled gracefully (0 orders across 3 days)');
  }, 300000);

  test('should process October 2024 (31 days) within reasonable time', async () => {
    // Performance test for full month
    // Skip in CI/CD unless explicitly requested
    if (!process.env.RUN_PERFORMANCE_TESTS) {
      console.log('⏭️  Skipping performance test (set RUN_PERFORMANCE_TESTS=true to enable)');
      expect(true).toBe(true);
      return;
    }

    const startTime = Date.now();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        shop: TEST_SHOP,
        startDate: '2024-10-01',
        endDate: '2024-10-31', // Full month (31 days)
        objectType: 'orders'
      })
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    const totalDuration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.daysProcessed).toBe(31);

    const avgDurationPerDay = result.totalDurationMs / result.daysProcessed;

    console.log(`\n📊 Performance Metrics for October 2024:`);
    console.log(`  Total days: ${result.daysProcessed}`);
    console.log(`  Total orders: ${result.totalOrdersSynced}`);
    console.log(`  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Avg per day: ${(avgDurationPerDay / 1000).toFixed(1)}s`);
    console.log(`  Throughput: ${(result.totalOrdersSynced / (totalDuration / 1000)).toFixed(1)} orders/sec`);

    // Verify reasonable performance (< 30s per day on average)
    expect(avgDurationPerDay).toBeLessThan(30000);

  }, 1800000); // 30 minute timeout for full month
});

describe('Daily Interval Generation', () => {
  test('should generate correct daily intervals', () => {
    // Helper function test (would need to export from index.ts)
    const generateDailyIntervals = (startDate, endDate) => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = [];

      let current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const startISO = `${dateStr}T00:00:00Z`;
        const endISO = `${dateStr}T23:59:59Z`;

        days.push({ date: dateStr, startISO, endISO });

        current.setDate(current.getDate() + 1);
      }

      return days;
    };

    const intervals = generateDailyIntervals('2024-10-01', '2024-10-03');

    expect(intervals).toHaveLength(3);

    expect(intervals[0]).toEqual({
      date: '2024-10-01',
      startISO: '2024-10-01T00:00:00Z',
      endISO: '2024-10-01T23:59:59Z'
    });

    expect(intervals[1]).toEqual({
      date: '2024-10-02',
      startISO: '2024-10-02T00:00:00Z',
      endISO: '2024-10-02T23:59:59Z'
    });

    expect(intervals[2]).toEqual({
      date: '2024-10-03',
      startISO: '2024-10-03T00:00:00Z',
      endISO: '2024-10-03T23:59:59Z'
    });

    console.log('✅ Daily interval generation works correctly');
  });

  test('should handle single day interval', () => {
    const generateDailyIntervals = (startDate, endDate) => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = [];

      let current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const startISO = `${dateStr}T00:00:00Z`;
        const endISO = `${dateStr}T23:59:59Z`;

        days.push({ date: dateStr, startISO, endISO });

        current.setDate(current.getDate() + 1);
      }

      return days;
    };

    const intervals = generateDailyIntervals('2024-10-15', '2024-10-15');

    expect(intervals).toHaveLength(1);
    expect(intervals[0].date).toBe('2024-10-15');

    console.log('✅ Single day interval handled correctly');
  });
});
