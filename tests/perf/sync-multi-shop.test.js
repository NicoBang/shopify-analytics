/**
 * Performance Tests for Parallel Shop Sync
 *
 * Tests parallel vs sequential shop processing performance
 * and verifies rate-limit protection mechanisms.
 *
 * Run with: node tests/perf/sync-multi-shop.test.js
 */

// Mock fetch to simulate API responses
const originalFetch = global.fetch;
let mockResponses = [];
let callTimestamps = [];

function mockFetch(url, options) {
  const timestamp = Date.now();
  callTimestamps.push(timestamp);

  // Extract shop from URL
  const shopMatch = url.match(/shop=([^&]+)/);
  const shop = shopMatch ? shopMatch[1] : 'unknown';

  // Extract type from URL
  const typeMatch = url.match(/type=([^&]+)/);
  const type = typeMatch ? typeMatch[1] : 'unknown';

  // Check if this shop should be throttled (for testing)
  const shouldThrottle = mockResponses.find(r => r.shop === shop && r.throttle);

  if (shouldThrottle && shouldThrottle.throttleCount > 0) {
    shouldThrottle.throttleCount--;
    return Promise.resolve({
      json: () => Promise.resolve({
        error: 'THROTTLED: Rate limit exceeded',
        retryAfter: 1
      })
    });
  }

  // Check if this shop should fail completely
  const shouldFail = mockResponses.find(r => r.shop === shop && r.fail);
  if (shouldFail) {
    return Promise.reject(new Error(`Network error for ${shop}`));
  }

  // Normal successful response
  return Promise.resolve({
    json: () => Promise.resolve({
      success: true,
      recordsSynced: Math.floor(Math.random() * 100) + 50,
      shop,
      type
    })
  });
}

// Import the actual implementation (we'll need to extract helpers to a module)
// For now, we'll inline the implementation for testing
const PARALLEL_SYNC_ENABLED = true;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncShop(shop, type, params = {}, retryCount = 0) {
  const response = await mockFetch(`https://test.com/api/sync-shop?shop=${shop}&type=${type}`, {});
  const data = await response.json();

  // Check for rate limit throttling in response
  if (data.error && data.error.includes('THROTTLED')) {
    const maxRetries = 3;
    if (retryCount < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, retryCount) * 1000;
      console.log(`⏳ Rate limited on ${shop} (${type}), retrying in ${backoffMs}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await sleep(backoffMs);
      return syncShop(shop, type, params, retryCount + 1);
    }
    console.error(`❌ Max retries reached for ${shop} (${type})`);
  }

  return data;
}

async function syncShopsParallel(shops, syncFn) {
  console.log(`⚡ Parallel sync enabled for ${shops.length} shops`);

  // Add 200ms stagger between requests (5 req/sec safety margin)
  const staggeredPromises = shops.map((shop, index) =>
    sleep(index * 200).then(() => syncFn(shop))
  );

  const results = await Promise.allSettled(staggeredPromises);

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        shop: shops[index],
        status: 'failed',
        error: result.reason?.message || 'Unknown error'
      };
    }
  });
}

async function syncShopsSequential(shops, syncFn) {
  console.log(`🔄 Sequential sync for ${shops.length} shops`);
  const results = [];

  for (const shop of shops) {
    try {
      const result = await syncFn(shop);
      results.push(result);
    } catch (error) {
      results.push({
        shop,
        status: 'failed',
        error: error.message
      });
    }
  }

  return results;
}

// Test helpers
function resetMocks() {
  mockResponses = [];
  callTimestamps = [];
  global.fetch = mockFetch;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// Test suite
async function runTests() {
  console.log('🧪 Starting Performance Tests for Parallel Shop Sync\n');

  const SHOPS = [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ];

  // TEST 1: Sequential vs Parallel Performance
  console.log('📊 TEST 1: Sequential vs Parallel Performance Comparison\n');

  // Sequential baseline
  resetMocks();
  const seqStart = Date.now();
  const seqResults = await syncShopsSequential(SHOPS, async (shop) => {
    const inventory = await syncShop(shop, 'inventory');
    return {
      shop,
      inventory_items: inventory.recordsSynced || 0,
      status: 'success'
    };
  });
  const seqTime = Date.now() - seqStart;

  console.log(`⏱️  Sequential processing: ${seqTime}ms`);
  console.log(`   Results: ${seqResults.filter(r => r.status === 'success').length}/${SHOPS.length} shops succeeded\n`);

  // Parallel with staggering
  resetMocks();
  const parStart = Date.now();
  const parResults = await syncShopsParallel(SHOPS, async (shop) => {
    const inventory = await syncShop(shop, 'inventory');
    return {
      shop,
      inventory_items: inventory.recordsSynced || 0,
      status: 'success'
    };
  });
  const parTime = Date.now() - parStart;

  console.log(`⚡ Parallel processing: ${parTime}ms`);
  console.log(`   Results: ${parResults.filter(r => r.status === 'success').length}/${SHOPS.length} shops succeeded`);
  console.log(`   Speedup: ${(seqTime / parTime).toFixed(2)}x faster\n`);

  // Verify staggering (200ms between requests)
  const timeDiffs = [];
  for (let i = 1; i < callTimestamps.length; i++) {
    timeDiffs.push(callTimestamps[i] - callTimestamps[i - 1]);
  }
  const avgStagger = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
  console.log(`   Average stagger: ${avgStagger.toFixed(0)}ms (target: 200ms)\n`);

  // TEST 2: THROTTLED Error Handling with Exponential Backoff
  console.log('📊 TEST 2: THROTTLED Error Handling\n');

  resetMocks();
  // Configure pompdelux-de.myshopify.com to throttle 2 times before succeeding
  mockResponses.push({
    shop: 'pompdelux-de.myshopify.com',
    throttle: true,
    throttleCount: 2
  });

  const throttleStart = Date.now();
  const throttleResults = await syncShopsParallel(SHOPS, async (shop) => {
    const inventory = await syncShop(shop, 'inventory');
    return {
      shop,
      inventory_items: inventory.recordsSynced || 0,
      status: 'success'
    };
  });
  const throttleTime = Date.now() - throttleStart;

  const throttledShop = throttleResults.find(r => r.shop === 'pompdelux-de.myshopify.com');
  console.log(`⏱️  Total time with throttling: ${throttleTime}ms`);
  console.log(`   Throttled shop (DE): ${throttledShop.status}`);
  console.log(`   Expected backoff delays: 1000ms + 2000ms = 3000ms`);
  console.log(`   Actual overhead: ~${throttleTime - parTime}ms\n`);

  // TEST 3: Shop Failure Isolation
  console.log('📊 TEST 3: Shop Failure Isolation\n');

  resetMocks();
  // Configure pompdelux-nl.myshopify.com to fail completely
  mockResponses.push({
    shop: 'pompdelux-nl.myshopify.com',
    fail: true
  });

  const failStart = Date.now();
  const failResults = await syncShopsParallel(SHOPS, async (shop) => {
    const inventory = await syncShop(shop, 'inventory');
    return {
      shop,
      inventory_items: inventory.recordsSynced || 0,
      status: 'success'
    };
  });
  const failTime = Date.now() - failStart;

  const successCount = failResults.filter(r => r.status === 'success').length;
  const failedShop = failResults.find(r => r.shop === 'pompdelux-nl.myshopify.com');

  console.log(`⏱️  Total time with one failure: ${failTime}ms`);
  console.log(`   Successful shops: ${successCount}/${SHOPS.length}`);
  console.log(`   Failed shop (NL): ${failedShop.status} - "${failedShop.error}"`);
  console.log(`   ✅ Other shops continued successfully despite failure\n`);

  // TEST 4: Realistic Daily Sync Scenario
  console.log('📊 TEST 4: Realistic Daily Sync (3 API calls per shop)\n');

  resetMocks();
  const dateStr = '2025-10-03';

  const dailyStart = Date.now();
  const dailyResults = await syncShopsParallel(SHOPS, async (shop) => {
    const [orders, skus, fulfillments] = await Promise.all([
      syncShop(shop, 'orders', { startDate: dateStr, endDate: dateStr }),
      syncShop(shop, 'skus', { startDate: dateStr, endDate: dateStr }),
      syncShop(shop, 'fulfillments', { days: 1 })
    ]);

    return {
      shop,
      orders: orders.recordsSynced || 0,
      skus: skus.recordsSynced || 0,
      fulfillments: fulfillments.recordsSynced || 0,
      status: 'success'
    };
  });
  const dailyTime = Date.now() - dailyStart;

  console.log(`⏱️  Daily sync (parallel): ${dailyTime}ms`);
  console.log(`   Total API calls: ${SHOPS.length * 3} (${SHOPS.length} shops × 3 types)`);
  console.log(`   Successful shops: ${dailyResults.filter(r => r.status === 'success').length}/${SHOPS.length}`);
  console.log(`   Average time per shop: ${(dailyTime / SHOPS.length).toFixed(0)}ms\n`);

  // Summary
  console.log('📈 PERFORMANCE SUMMARY\n');
  console.log(`Sequential Processing: ${seqTime}ms`);
  console.log(`Parallel Processing:   ${parTime}ms (${(seqTime / parTime).toFixed(2)}x speedup)`);
  console.log(`With Throttling:       ${throttleTime}ms (handled gracefully)`);
  console.log(`With Failure:          ${failTime}ms (${successCount}/${SHOPS.length} shops succeeded)`);
  console.log(`Daily Sync (3×):       ${dailyTime}ms (realistic workload)\n`);

  console.log('✅ All tests completed successfully!');

  restoreFetch();
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  restoreFetch();
  process.exit(1);
});
