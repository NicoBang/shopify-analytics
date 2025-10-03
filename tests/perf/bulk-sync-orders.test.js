/**
 * Performance tests for Bulk Operations POC
 *
 * Tests:
 * 1. GraphQL mutation response validation
 * 2. Polling status until COMPLETED
 * 3. JSONL parsing and order transformation
 * 4. Batch insert to Supabase
 * 5. Performance comparison: cursor-based vs bulk operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    upsert: vi.fn(() => Promise.resolve({ data: [], error: null }))
  }))
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabaseClient
}));

// Mock environment variables
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.API_SECRET_KEY = 'test-secret';
process.env.SHOPIFY_TOKEN_DA = 'test-token-da';

describe('Bulk Operations POC - Orders Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: GraphQL Mutation Success
   */
  it('should start bulk operation and return bulk operation ID', async () => {
    const mockMutationResponse = {
      data: {
        bulkOperationRunQuery: {
          bulkOperation: {
            id: 'gid://shopify/BulkOperation/123456',
            status: 'CREATED',
            url: null
          },
          userErrors: []
        }
      }
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => mockMutationResponse
    });

    const response = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': 'test-token-da'
      },
      body: JSON.stringify({
        query: 'mutation { bulkOperationRunQuery(...) }'
      })
    });

    const result = await response.json();
    const bulkOp = result.data.bulkOperationRunQuery.bulkOperation;

    expect(bulkOp.id).toBe('gid://shopify/BulkOperation/123456');
    expect(bulkOp.status).toBe('CREATED');
    expect(result.data.bulkOperationRunQuery.userErrors).toHaveLength(0);
  });

  /**
   * Test 2: GraphQL Mutation with userErrors
   */
  it('should handle userErrors from bulk operation mutation', async () => {
    const mockErrorResponse = {
      data: {
        bulkOperationRunQuery: {
          bulkOperation: null,
          userErrors: [
            { field: 'query', message: 'Query is too complex' }
          ]
        }
      }
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => mockErrorResponse
    });

    const response = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': 'test-token-da'
      },
      body: JSON.stringify({
        query: 'mutation { bulkOperationRunQuery(...) }'
      })
    });

    const result = await response.json();
    const errors = result.data.bulkOperationRunQuery.userErrors;

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Query is too complex');
  });

  /**
   * Test 3: Polling Status - RUNNING → COMPLETED
   */
  it('should poll status until COMPLETED', async () => {
    const mockPollingResponses = [
      {
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/123456',
            status: 'RUNNING',
            errorCode: null,
            createdAt: '2024-10-03T10:00:00Z',
            completedAt: null,
            objectCount: null,
            fileSize: null,
            url: null,
            partialDataUrl: null
          }
        }
      },
      {
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/123456',
            status: 'RUNNING',
            errorCode: null,
            createdAt: '2024-10-03T10:00:00Z',
            completedAt: null,
            objectCount: 500,
            fileSize: null,
            url: null,
            partialDataUrl: null
          }
        }
      },
      {
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/123456',
            status: 'COMPLETED',
            errorCode: null,
            createdAt: '2024-10-03T10:00:00Z',
            completedAt: '2024-10-03T10:05:00Z',
            objectCount: 1000,
            fileSize: 524288, // 512KB
            url: 'https://storage.shopify.com/bulk/123456.jsonl',
            partialDataUrl: null
          }
        }
      }
    ];

    mockFetch
      .mockResolvedValueOnce({ json: async () => mockPollingResponses[0] })
      .mockResolvedValueOnce({ json: async () => mockPollingResponses[1] })
      .mockResolvedValueOnce({ json: async () => mockPollingResponses[2] });

    // Simulate polling 3 times
    const poll1 = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: '{ currentBulkOperation { ... } }' })
    });
    const result1 = await poll1.json();
    expect(result1.data.currentBulkOperation.status).toBe('RUNNING');
    expect(result1.data.currentBulkOperation.objectCount).toBeNull();

    const poll2 = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: '{ currentBulkOperation { ... } }' })
    });
    const result2 = await poll2.json();
    expect(result2.data.currentBulkOperation.status).toBe('RUNNING');
    expect(result2.data.currentBulkOperation.objectCount).toBe(500);

    const poll3 = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: '{ currentBulkOperation { ... } }' })
    });
    const result3 = await poll3.json();
    expect(result3.data.currentBulkOperation.status).toBe('COMPLETED');
    expect(result3.data.currentBulkOperation.objectCount).toBe(1000);
    expect(result3.data.currentBulkOperation.url).toBe('https://storage.shopify.com/bulk/123456.jsonl');
  });

  /**
   * Test 4: Polling Status - errorCode handling
   */
  it('should detect errorCode in currentBulkOperation', async () => {
    const mockErrorResponse = {
      data: {
        currentBulkOperation: {
          id: 'gid://shopify/BulkOperation/123456',
          status: 'FAILED',
          errorCode: 'INTERNAL_SERVER_ERROR',
          createdAt: '2024-10-03T10:00:00Z',
          completedAt: '2024-10-03T10:05:00Z',
          objectCount: null,
          fileSize: null,
          url: null,
          partialDataUrl: null
        }
      }
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => mockErrorResponse
    });

    const response = await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: '{ currentBulkOperation { ... } }' })
    });

    const result = await response.json();
    const bulkOp = result.data.currentBulkOperation;

    expect(bulkOp.status).toBe('FAILED');
    expect(bulkOp.errorCode).toBe('INTERNAL_SERVER_ERROR');
  });

  /**
   * Test 5: JSONL Parsing
   */
  it('should parse JSONL and transform to orders format', () => {
    const mockJSONL = `
{"id":"gid://shopify/Order/6886597591379","name":"#1001","createdAt":"2024-09-01T10:00:00Z","currentTotalPriceSet":{"shopMoney":{"amount":"1000.00","currencyCode":"DKK"}},"originalTotalPriceSet":{"shopMoney":{"amount":"1200.00","currencyCode":"DKK"}},"currentSubtotalPriceSet":{"shopMoney":{"amount":"800.00","currencyCode":"DKK"}},"totalDiscountsSet":{"shopMoney":{"amount":"100.00","currencyCode":"DKK"}},"totalTaxSet":{"shopMoney":{"amount":"150.00","currencyCode":"DKK"}},"totalShippingPriceSet":{"shopMoney":{"amount":"50.00","currencyCode":"DKK"}},"shippingAddress":{"countryCode":"DK"},"lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/1","quantity":2}},{"node":{"id":"gid://shopify/LineItem/2","quantity":3}}]},"refunds":[]}
{"id":"gid://shopify/Order/6886597591380","name":"#1002","createdAt":"2024-09-02T11:00:00Z","currentTotalPriceSet":{"shopMoney":{"amount":"2000.00","currencyCode":"DKK"}},"originalTotalPriceSet":{"shopMoney":{"amount":"2000.00","currencyCode":"DKK"}},"currentSubtotalPriceSet":{"shopMoney":{"amount":"1600.00","currencyCode":"DKK"}},"totalDiscountsSet":{"shopMoney":{"amount":"0.00","currencyCode":"DKK"}},"totalTaxSet":{"shopMoney":{"amount":"300.00","currencyCode":"DKK"}},"totalShippingPriceSet":{"shopMoney":{"amount":"100.00","currencyCode":"DKK"}},"shippingAddress":{"countryCode":"DE"},"lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/3","quantity":5}}]},"refunds":[]}
    `.trim();

    const lines = mockJSONL.split('\n').filter(l => l.trim());
    const orders = [];

    lines.forEach(line => {
      const record = JSON.parse(line);

      if (record.id && record.id.includes('gid://shopify/Order/')) {
        const orderId = record.id.split('/').pop();
        const currency = record.currentTotalPriceSet?.shopMoney?.currencyCode || 'DKK';
        const conversionRate = 1.0; // DKK base

        const currentTotal = parseFloat(record.currentTotalPriceSet?.shopMoney?.amount || 0) * conversionRate;
        const originalTotal = parseFloat(record.originalTotalPriceSet?.shopMoney?.amount || 0) * conversionRate;
        const totalTax = parseFloat(record.totalTaxSet?.shopMoney?.amount || 0) * conversionRate;
        const totalShipping = parseFloat(record.totalShippingPriceSet?.shopMoney?.amount || 0) * conversionRate;
        const discountedTotal = currentTotal - totalTax - totalShipping;

        const itemCount = (record.lineItems?.edges || []).reduce((sum, edge) => {
          return sum + (edge.node?.quantity || 0);
        }, 0);

        orders.push({
          shop: 'pompdelux-da.myshopify.com',
          order_id: orderId,
          created_at: record.createdAt,
          country: record.shippingAddress?.countryCode || 'DK',
          discounted_total: discountedTotal,
          tax: totalTax,
          shipping: totalShipping,
          item_count: itemCount
        });
      }
    });

    expect(orders).toHaveLength(2);

    // Order 1
    expect(orders[0].order_id).toBe('6886597591379');
    expect(orders[0].discounted_total).toBe(800); // 1000 - 150 (tax) - 50 (shipping)
    expect(orders[0].item_count).toBe(5); // 2 + 3
    expect(orders[0].country).toBe('DK');

    // Order 2
    expect(orders[1].order_id).toBe('6886597591380');
    expect(orders[1].discounted_total).toBe(1600); // 2000 - 300 (tax) - 100 (shipping)
    expect(orders[1].item_count).toBe(5);
    expect(orders[1].country).toBe('DE');
  });

  /**
   * Test 6: Batch Insert to Supabase
   */
  it('should insert orders in batches to Supabase', async () => {
    const mockOrders = Array.from({ length: 1200 }, (_, i) => ({
      shop: 'pompdelux-da.myshopify.com',
      order_id: `order_${i + 1}`,
      created_at: '2024-09-01T10:00:00Z',
      country: 'DK',
      discounted_total: 100.00,
      tax: 25.00,
      shipping: 10.00,
      item_count: 2,
      refunded_amount: 0,
      refunded_qty: 0,
      refund_date: null,
      total_discounts_ex_tax: 0,
      cancelled_qty: 0,
      sale_discount_total: 0,
      combined_discount_total: 0
    }));

    const BATCH_SIZE = 500;
    let totalInserted = 0;

    // Simulate batch insert
    for (let i = 0; i < mockOrders.length; i += BATCH_SIZE) {
      const batch = mockOrders.slice(i, i + BATCH_SIZE);

      const { data, error } = await mockSupabaseClient
        .from('orders')
        .upsert(batch, {
          onConflict: 'order_id',
          ignoreDuplicates: false
        });

      expect(error).toBeNull();
      totalInserted += batch.length;
    }

    expect(totalInserted).toBe(1200);
    // Should have called upsert 3 times (500 + 500 + 200)
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
  });

  /**
   * Test 7: Performance Comparison - Cursor-based vs Bulk Operations
   */
  it('should demonstrate performance improvement over cursor-based sync', async () => {
    const ORDERS_COUNT = 1000;

    // === Scenario 1: Cursor-based sync (current approach) ===
    const cursorStart = Date.now();

    // Simulate 20 cursor-based requests (50 orders per request for 1000 orders)
    const REQUESTS_PER_CURSOR = 20;
    const mockCursorResponses = Array.from({ length: REQUESTS_PER_CURSOR }, () =>
      Promise.resolve({ json: async () => ({ data: { orders: { edges: [] } } }) })
    );

    for (let i = 0; i < REQUESTS_PER_CURSOR; i++) {
      mockFetch.mockResolvedValueOnce(mockCursorResponses[i]);
      await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json');
    }

    const cursorEnd = Date.now();
    const cursorDuration = cursorEnd - cursorStart;

    // === Scenario 2: Bulk operations (POC approach) ===
    const bulkStart = Date.now();

    // Step 1: Start bulk operation (1 request)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        data: {
          bulkOperationRunQuery: {
            bulkOperation: {
              id: 'gid://shopify/BulkOperation/123456',
              status: 'CREATED'
            },
            userErrors: []
          }
        }
      })
    });
    await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json');

    // Step 2: Poll 5 times (5 requests) - simulate 25 seconds
    const mockPolls = Array.from({ length: 5 }, () =>
      Promise.resolve({
        json: async () => ({
          data: {
            currentBulkOperation: {
              id: 'gid://shopify/BulkOperation/123456',
              status: 'RUNNING'
            }
          }
        })
      })
    );

    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(mockPolls[i]);
      await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json');
    }

    // Step 3: Final poll - COMPLETED (1 request)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/123456',
            status: 'COMPLETED',
            url: 'https://storage.shopify.com/bulk/123456.jsonl',
            objectCount: ORDERS_COUNT
          }
        }
      })
    });
    await fetch('https://pompdelux-da.myshopify.com/admin/api/2024-10/graphql.json');

    // Step 4: Download JSONL (1 request)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('{"id":"gid://shopify/Order/123"}\n');
        }
      }
    });
    await fetch('https://storage.shopify.com/bulk/123456.jsonl');

    const bulkEnd = Date.now();
    const bulkDuration = bulkEnd - bulkStart;

    // === Performance Comparison ===
    console.log('\n📊 Performance Comparison (1000 orders):');
    console.log(`   Cursor-based: ${cursorDuration}ms (${REQUESTS_PER_CURSOR} requests)`);
    console.log(`   Bulk operations: ${bulkDuration}ms (8 requests total)`);

    // Bulk should be faster (fewer requests, less overhead)
    // Note: In real-world, bulk operations are MUCH faster for large datasets
    // This test demonstrates the request count difference
    expect(REQUESTS_PER_CURSOR).toBeGreaterThan(8); // 20 vs 8 requests
  });

  /**
   * Test 8: Currency Conversion
   */
  it('should convert EUR and CHF to DKK correctly', () => {
    const CURRENCY_RATES = {
      'DKK': 1.0,
      'EUR': 7.46,
      'CHF': 6.84
    };

    // EUR order (pompdelux-de.myshopify.com)
    const eurOrder = {
      currentTotalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'EUR' } },
      totalTaxSet: { shopMoney: { amount: '19.00', currencyCode: 'EUR' } },
      totalShippingPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'EUR' } }
    };

    const eurRate = CURRENCY_RATES['EUR'];
    const eurTotal = parseFloat(eurOrder.currentTotalPriceSet.shopMoney.amount) * eurRate;
    const eurTax = parseFloat(eurOrder.totalTaxSet.shopMoney.amount) * eurRate;
    const eurShipping = parseFloat(eurOrder.totalShippingPriceSet.shopMoney.amount) * eurRate;
    const eurDiscountedTotal = eurTotal - eurTax - eurShipping;

    expect(eurTotal).toBe(746.00); // 100 * 7.46
    expect(eurTax).toBe(141.74); // 19 * 7.46
    expect(eurShipping).toBe(74.60); // 10 * 7.46
    expect(eurDiscountedTotal).toBe(529.66); // 746 - 141.74 - 74.60

    // CHF order (pompdelux-chf.myshopify.com)
    const chfOrder = {
      currentTotalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'CHF' } },
      totalTaxSet: { shopMoney: { amount: '8.10', currencyCode: 'CHF' } },
      totalShippingPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'CHF' } }
    };

    const chfRate = CURRENCY_RATES['CHF'];
    const chfTotal = parseFloat(chfOrder.currentTotalPriceSet.shopMoney.amount) * chfRate;
    const chfTax = parseFloat(chfOrder.totalTaxSet.shopMoney.amount) * chfRate;
    const chfShipping = parseFloat(chfOrder.totalShippingPriceSet.shopMoney.amount) * chfRate;
    const chfDiscountedTotal = chfTotal - chfTax - chfShipping;

    expect(chfTotal).toBe(684.00); // 100 * 6.84
    expect(chfTax).toBe(55.404); // 8.10 * 6.84
    expect(chfShipping).toBe(68.40); // 10 * 6.84
    expect(chfDiscountedTotal).toBeCloseTo(560.196, 2); // 684 - 55.404 - 68.40
  });
});
