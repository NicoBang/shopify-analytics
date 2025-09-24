// api/sku-raw.js
// Raw SKU data endpoint without style aggregation
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Enable CORS and verify API key
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }

  return null;
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  try {
    const {
      startDate,
      endDate,
      shop = null,
      aggregateBy = null,
      limit = 10000
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required parameters: startDate and endDate'
      });
    }

    // Ensure full day coverage
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    console.log(`📊 Fetching raw SKU data: ${start.toISOString()} to ${end.toISOString()}`);

    // Fetch ALL data by using pagination
    let allData = [];
    let hasMore = true;
    let currentOffset = 0;
    const batchSize = 1000; // Supabase max is 1000 per request

    // If specific limit requested, use it; otherwise fetch everything
    const totalLimit = (limit && limit !== 'all') ? parseInt(limit) : 1000000;

    while (hasMore && allData.length < totalLimit) {
      const currentBatch = Math.min(batchSize, totalLimit - allData.length);

      // Build a fresh query for each batch
      let batchQuery = supabase
        .from('skus')
        .select('*')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false })
        .range(currentOffset, currentOffset + currentBatch - 1);

      if (shop) {
        batchQuery = batchQuery.eq('shop', shop);
      }

      const { data: batchData, error: batchError } = await batchQuery;

      if (batchError) {
        console.error('❌ Database error:', batchError);
        throw batchError;
      }

      if (batchData && batchData.length > 0) {
        allData = allData.concat(batchData);
        currentOffset += batchData.length;

        console.log(`📦 Fetched batch: ${batchData.length} records, total: ${allData.length}`);

        // Continue if we got exactly the batch size (means there might be more)
        // Stop if we got less than the batch size (means we reached the end)
        if (batchData.length < batchSize) {
          hasMore = false;
          console.log(`✅ Reached end of data (got ${batchData.length} < ${batchSize})`);
        }
      } else {
        hasMore = false;
        console.log(`✅ No more data available`);
      }
    }

    const data = allData;
    const error = null;

    if (error) {
      console.error('❌ Database error:', error);
      throw error;
    }

    console.log(`✅ Found ${data?.length || 0} SKU records`);

    // Calculate totals without aggregation
    const totalQuantity = data.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalRefunded = data.reduce((sum, item) => sum + (item.refunded_qty || 0), 0);
    const totalRevenue = data.reduce((sum, item) => sum + ((item.price_dkk || 0) * (item.quantity || 0)), 0);

    // Optional aggregation
    let aggregatedData = null;
    if (aggregateBy === 'artikelnummer') {
      const grouped = {};

      data.forEach(item => {
        const sku = item.sku || '';
        const artikelnummer = sku.split('\\')[0] || sku;

        if (!grouped[artikelnummer]) {
          grouped[artikelnummer] = {
            artikelnummer: artikelnummer,
            totalQuantity: 0,
            totalRefunded: 0,
            totalRevenue: 0,
            skuCount: 0,
            records: []
          };
        }

        grouped[artikelnummer].totalQuantity += item.quantity || 0;
        grouped[artikelnummer].totalRefunded += item.refunded_qty || 0;
        grouped[artikelnummer].totalRevenue += (item.price_dkk || 0) * (item.quantity || 0);
        grouped[artikelnummer].skuCount++;
        grouped[artikelnummer].records.push({
          sku: item.sku,
          quantity: item.quantity,
          price: item.price_dkk,
          shop: item.shop
        });
      });

      aggregatedData = Object.values(grouped);
      console.log(`📦 Aggregated to ${aggregatedData.length} unique artikelnummer`);
    }

    return res.status(200).json({
      success: true,
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString()
      },
      summary: {
        totalRecords: data.length,
        totalQuantitySold: totalQuantity,
        totalQuantityRefunded: totalRefunded,
        netQuantitySold: totalQuantity - totalRefunded,
        totalRevenue: totalRevenue.toFixed(2),
        uniqueSkus: [...new Set(data.map(item => item.sku))].length,
        uniqueOrders: [...new Set(data.map(item => item.order_id))].length,
        uniqueShops: [...new Set(data.map(item => item.shop))].length
      },
      aggregated: aggregatedData,
      rawData: aggregateBy ? null : data.slice(0, 100), // Return sample of raw data if not aggregating
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 SKU raw error:', error);
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};