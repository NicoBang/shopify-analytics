// Unified Vercel Cron endpoint - handles all automatic syncs
// Triggered by Vercel Cron with different job parameters

const SHOPS = [
  'pompdelux-da.myshopify.com',
  'pompdelux-de.myshopify.com',
  'pompdelux-nl.myshopify.com',
  'pompdelux-int.myshopify.com',
  'pompdelux-chf.myshopify.com'
];

const API_KEY = process.env.API_SECRET_KEY;

// Helper function to call sync-shop API
async function syncShop(shop, type, params = {}) {
  const baseUrl = `https://${process.env.VERCEL_URL || 'shopify-analytics-production.vercel.app'}`;
  const queryParams = new URLSearchParams({
    shop,
    type,
    ...params
  });

  const response = await fetch(`${baseUrl}/api/sync-shop?${queryParams}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  return response.json();
}

// CRON JOB HANDLERS
async function dailySync() {
  // Morning sync (08:00) - NEW orders & SKUs from yesterday
  console.log('🌅 Starting daily morning sync...');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  const results = { shops: [] };

  for (const shop of SHOPS) {
    try {
      const [orders, skus, fulfillments] = await Promise.all([
        syncShop(shop, 'orders', { startDate: dateStr, endDate: dateStr }),
        syncShop(shop, 'skus', { startDate: dateStr, endDate: dateStr }),
        syncShop(shop, 'fulfillments', { days: 1 })
      ]);

      results.shops.push({
        shop,
        orders: orders.recordsSynced || 0,
        skus: skus.recordsSynced || 0,
        fulfillments: fulfillments.recordsSynced || 0,
        status: 'success'
      });
    } catch (error) {
      results.shops.push({ shop, status: 'failed', error: error.message });
    }
  }

  return results;
}

async function updateSync() {
  // Afternoon sync (16:00) - UPDATED orders/SKUs (refunds)
  console.log('🔄 Starting afternoon update sync...');

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 3);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = today.toISOString().split('T')[0];

  const results = { shops: [] };

  for (const shop of SHOPS) {
    try {
      const [orders, skus] = await Promise.all([
        syncShop(shop, 'orders', { startDate: startDateStr, endDate: endDateStr, updatedMode: true }),
        syncShop(shop, 'skus', { startDate: startDateStr, endDate: endDateStr, updatedMode: true })
      ]);

      results.shops.push({
        shop,
        orders_updated: orders.recordsSynced || 0,
        skus_updated: skus.recordsSynced || 0,
        status: 'success'
      });
    } catch (error) {
      results.shops.push({ shop, status: 'failed', error: error.message });
    }
  }

  return results;
}

async function inventorySync() {
  // Evening sync (22:00) - Inventory levels
  console.log('📦 Starting evening inventory sync...');

  const results = { shops: [] };

  for (const shop of SHOPS) {
    try {
      const inventory = await syncShop(shop, 'inventory');

      results.shops.push({
        shop,
        inventory_items: inventory.recordsSynced || 0,
        status: 'success'
      });
    } catch (error) {
      results.shops.push({ shop, status: 'failed', error: error.message });
    }
  }

  return results;
}

async function metadataSync(statusFilter = null) {
  // Daily sync for active products, weekly sync for all products
  const filterLabel = statusFilter ? `(status: ${statusFilter})` : '(all products)';
  console.log(`📋 Starting metadata sync ${filterLabel} (Danish shop only)...`);

  const results = { shops: [] };

  // CRITICAL: Metadata sync ONLY from Danish shop
  const danskShop = 'pompdelux-da.myshopify.com';

  try {
    const params = statusFilter ? { status: statusFilter } : {};
    const metadata = await syncShop(danskShop, 'metadata', params);

    results.shops.push({
      shop: danskShop,
      metadata_items: metadata.recordsSynced || 0,
      status: 'success',
      filter: statusFilter || 'all'
    });
  } catch (error) {
    results.shops.push({ shop: danskShop, status: 'failed', error: error.message });
  }

  return results;
}

// Consolidated cron handlers for Free tier (max 2 cron jobs)
async function morningSync() {
  // Combined morning sync: daily + update
  console.log('🌅 Starting morning sync (daily + update)...');

  const dailyResults = await dailySync();
  const updateResults = await updateSync();

  return {
    daily: dailyResults,
    update: updateResults
  };
}

async function eveningSync() {
  // Combined evening sync: inventory + metadata (active products only for daily sync)
  console.log('🌙 Starting evening sync (inventory + active products metadata)...');

  const inventoryResults = await inventorySync();
  const metadataResults = await metadataSync('active'); // Only sync active products daily

  return {
    inventory: inventoryResults,
    metadata: metadataResults
  };
}

// MAIN HANDLER
export default async function handler(req, res) {
  // Security: Only allow Vercel Cron to trigger this
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { job } = req.query;

  if (!job) {
    return res.status(400).json({
      error: 'Missing job parameter',
      availableJobs: ['morning', 'evening', 'daily', 'update', 'inventory', 'metadata']
    });
  }

  console.log(`🚀 Running cron job: ${job}`);

  try {
    let results;

    switch (job) {
      // Consolidated jobs (for Free tier)
      case 'morning':
        results = await morningSync();
        break;
      case 'evening':
        results = await eveningSync();
        break;

      // Individual jobs (for manual testing)
      case 'daily':
        results = await dailySync();
        break;
      case 'update':
        results = await updateSync();
        break;
      case 'inventory':
        results = await inventorySync();
        break;
      case 'metadata':
        results = await metadataSync();
        break;
      default:
        return res.status(400).json({ error: `Unknown job: ${job}` });
    }

    console.log(`✅ Cron job ${job} completed:`, results);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      job,
      ...results
    });

  } catch (error) {
    console.error(`❌ Cron job ${job} failed:`, error);
    return res.status(500).json({
      error: error.message,
      job
    });
  }
}