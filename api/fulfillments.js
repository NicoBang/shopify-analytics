// api/fulfillments.js - Robust Long-term Solution
const { createClient } = require('@supabase/supabase-js');

// Robust SupabaseService with proper error handling and deduplication
class SupabaseService {
  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase URL and Service Key are required in environment variables');
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  // Helper function to extract Shopify order ID (now inside class)
  extractId(fullId) {
    const str = String(fullId || "");
    const match = str.match(/\/(\d+)$/);
    return match ? match[1] : str;
  }

  // Enhanced getFulfillments with pagination support
  async getFulfillments(startDate, endDate, options = {}) {
    const { carrier, country, limit = 10000, offset = 0, includeTotals = false } = options;

    let query = this.supabase
      .from('fulfillments')
      .select('*')
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: false });

    if (carrier && carrier !== 'all') {
      query = query.eq('carrier', carrier);
    }

    if (country && country !== 'all') {
      query = query.eq('country', country);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching fulfillments:', error);
      throw error;
    }

    return { data: data || [], error: null };
  }

  // Enhanced delivery analytics with ALL fixes applied
  async getEnhancedDeliveryAnalytics(startDate, endDate) {
    console.log(`🚚 Enhanced Delivery Analytics: ${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`);

    // Get ALL fulfillments using chunked pagination (no 1000 limit)
    let allFulfillments = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error: batchError } = await this.supabase
        .from('fulfillments')
        .select('*')
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString())
        .range(offset, offset + batchSize - 1);

      if (batchError) {
        console.error('❌ Error fetching fulfillments:', batchError);
        throw batchError;
      }

      if (batch && batch.length > 0) {
        allFulfillments = allFulfillments.concat(batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Fetched ${allFulfillments.length} total fulfillments`);

    // FIXED: Get orders from 90-day cache window (like old system) using pagination
    const cacheStartDate = new Date(endDate);
    cacheStartDate.setDate(cacheStartDate.getDate() - 90); // 90 days back like old system

    let allOrdersData = [];
    let orderOffset = 0;
    const orderBatchSize = 1000;
    let hasMoreOrders = true;

    while (hasMoreOrders) {
      const { data: batch, error: batchError } = await this.supabase
        .from('orders')
        .select('order_id, country, refunded_qty, refund_date')
        .gte('created_at', cacheStartDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .range(orderOffset, orderOffset + orderBatchSize - 1);

      if (batchError) {
        console.error('❌ Error fetching orders:', batchError);
        throw batchError;
      }

      if (batch && batch.length > 0) {
        allOrdersData = allOrdersData.concat(batch);
        hasMoreOrders = batch.length === orderBatchSize;
        orderOffset += orderBatchSize;
      } else {
        hasMoreOrders = false;
      }
    }

    console.log(`✅ Fetched ${allOrdersData.length} orders from 90-day window`);

    // Calculate enhanced metrics with proper carrier mapping
    return this.calculateEnhancedDeliveryMetrics(
      allOrdersData || [],
      allFulfillments || [],
      startDate,
      endDate
    );
  }

  // Robust carrier mapping and returns analysis
  async calculateEnhancedDeliveryMetrics(orderData, fulfillmentData, startDate, endDate) {
    const fulfillmentMatrix = {};
    const carriers = new Set();
    const countries = new Set();
    let totalFulfillments = 0;
    let totalFulfilledItems = 0;

    // Process fulfillments (already filtered by date)
    fulfillmentData.forEach(fulfillment => {
      const key = `${fulfillment.country}|${fulfillment.carrier}`;
      countries.add(fulfillment.country);
      carriers.add(fulfillment.carrier);
      fulfillmentMatrix[key] = (fulfillmentMatrix[key] || 0) + 1;

      totalFulfillments++;
      totalFulfilledItems += Number(fulfillment.item_count) || 0;
    });

    // ROBUST CARRIER MAPPING - Use order_id directly (no extractId)
    const orderIdToCarrier = {};

    try {
      // Get ALL fulfillments for carrier mapping using pagination
      let allFulfillments = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error: batchError } = await this.supabase
          .from('fulfillments')
          .select('order_id, carrier')
          .range(offset, offset + batchSize - 1);

        if (batchError) throw batchError;

        if (batch && batch.length > 0) {
          allFulfillments = allFulfillments.concat(batch);
          hasMore = batch.length === batchSize;
          offset += batchSize;
        } else {
          hasMore = false;
        }
      }

      // Build carrier mapping using direct order_id
      allFulfillments.forEach(f => {
        if (f.order_id && f.carrier) {
          orderIdToCarrier[f.order_id] = f.carrier;
        }
      });

    } catch (error) {
      console.error('⚠️ Could not get comprehensive carrier mapping:', error);
      // Fallback: use period fulfillments only
      fulfillmentData.forEach(fulfillment => {
        orderIdToCarrier[fulfillment.order_id] = fulfillment.carrier;
      });
    }

    // Process returns with carrier mapping
    const returnsMatrix = {};
    const returnCountries = new Set();
    let totalReturnedItems = 0;

    orderData.forEach(order => {
      // Use date-only comparison (not timestamp)
      const refundDateStr = order.refund_date ? order.refund_date.split('T')[0] : null;
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      if (refundDateStr && refundDateStr >= startDateStr && refundDateStr <= endDateStr) {
        const orderId = order.order_id;
        const carrier = orderIdToCarrier[orderId] || "Ukendt";
        const country = order.country || "Ukendt";

        const key = `${country}|${carrier}`;
        returnCountries.add(country);
        returnsMatrix[key] = (returnsMatrix[key] || 0) + 1;

        totalReturnedItems += Number(order.refunded_qty) || 0;
      }
    });

    const totalReturns = Object.values(returnsMatrix).reduce((a, b) => a + b, 0);
    console.log(`✅ Processed: ${totalFulfillments} fulfillments, ${totalReturns} returns`);

    return {
      fulfillmentMatrix,
      carriers: Array.from(carriers).sort(),
      countries: Array.from(countries).sort(),
      totalFulfillments,
      totalFulfilledItems,
      returnsMatrix,
      returnCountries: Array.from(returnCountries).sort(),
      totalReturnedItems,
      totalReturns,
      returnRate: totalFulfillments > 0
        ? ((totalReturns / totalFulfillments) * 100).toFixed(2) + '%'
        : '0%',
      itemReturnRate: totalFulfilledItems > 0
        ? ((totalReturnedItems / totalFulfilledItems) * 100).toFixed(2) + '%'
        : '0%',
      // Enhanced diagnostics
      diagnostics: {
        carrierMappingCount: Object.keys(orderIdToCarrier).length,
        sampleCarrierMappings: Object.entries(orderIdToCarrier).slice(0, 3).map(([id, carrier]) => `${id}=${carrier}`),
        sampleOrderIds: orderData.slice(0, 3).map(o => o.order_id),
        fulfillmentDataCount: fulfillmentData.length,
        orderDataCount: orderData.length,
        returnsProcessed: totalReturns,
        paginationBatches: Math.ceil(fulfillmentData.length / 1000)
      }
    };
  }

  // Standard delivery analytics processing
  processDeliveryAnalytics(data) {
    const analytics = {
      totalOrders: 0,
      totalFulfillments: data.length,
      totalItems: 0,
      byCarrier: {},
      byCountry: {},
      byDate: {}
    };

    data.forEach(fulfillment => {
      analytics.totalItems += Number(fulfillment.item_count) || 0;

      // Group by carrier
      if (!analytics.byCarrier[fulfillment.carrier]) {
        analytics.byCarrier[fulfillment.carrier] = { count: 0, items: 0 };
      }
      analytics.byCarrier[fulfillment.carrier].count++;
      analytics.byCarrier[fulfillment.carrier].items += Number(fulfillment.item_count) || 0;

      // Group by country
      if (!analytics.byCountry[fulfillment.country]) {
        analytics.byCountry[fulfillment.country] = { count: 0, items: 0 };
      }
      analytics.byCountry[fulfillment.country].count++;
      analytics.byCountry[fulfillment.country].items += Number(fulfillment.item_count) || 0;

      // Group by date
      const date = fulfillment.date?.split('T')[0];
      if (date) {
        if (!analytics.byDate[date]) {
          analytics.byDate[date] = { count: 0, items: 0 };
        }
        analytics.byDate[date].count++;
        analytics.byDate[date].items += Number(fulfillment.item_count) || 0;
      }
    });

    return analytics;
  }

  // Robust fulfillment sync with proper deduplication
  async upsertFulfillments(fulfillments) {
    if (!fulfillments || fulfillments.length === 0) return { count: 0 };

    // Map fulfillments to database schema
    const dbFulfillments = fulfillments.map(fulfillment => ({
      order_id: fulfillment.orderId.replace('gid://shopify/Order/', ''),
      date: fulfillment.date,
      country: fulfillment.country,
      carrier: fulfillment.carrier,
      item_count: fulfillment.itemCount
    }));

    try {
      // Check for existing fulfillments (deduplication)
      const orderIds = dbFulfillments.map(f => f.order_id);
      const { data: existing, error: checkError } = await this.supabase
        .from('fulfillments')
        .select('order_id')
        .in('order_id', orderIds);

      if (checkError) {
        console.error('❌ Error checking existing fulfillments:', checkError);
        throw checkError;
      }

      const existingOrderIds = new Set(existing.map(e => e.order_id));
      const newFulfillments = dbFulfillments.filter(f => !existingOrderIds.has(f.order_id));

      if (newFulfillments.length === 0) {
        return { count: 0, data: [] };
      }

      // Insert only new fulfillments
      const { data, error } = await this.supabase
        .from('fulfillments')
        .insert(newFulfillments);

      if (error) {
        console.error('❌ Error inserting fulfillments:', error);
        throw error;
      }

      console.log(`✅ Inserted ${newFulfillments.length} new fulfillments`);
      return { count: newFulfillments.length, data };

    } catch (error) {
      console.error('❌ Error in upsertFulfillments:', error);
      throw error;
    }
  }

  // Clean up duplicate fulfillments - keep only the oldest occurrence of each unique combination
  async cleanupDuplicateFulfillments() {
    console.log('🧹 Starting cleanup of duplicate fulfillments...');

    try {
      // Get ALL fulfillments using pagination
      let allFulfillments = [];
      let cleanupOffset = 0;
      const cleanupBatchSize = 1000;
      let hasMoreForCleanup = true;

      while (hasMoreForCleanup) {
        const { data: batch, error: fetchError } = await this.supabase
          .from('fulfillments')
          .select('id, order_id, date, country, carrier, item_count, created_at')
          .order('created_at', { ascending: true })
          .range(cleanupOffset, cleanupOffset + cleanupBatchSize - 1);

        if (fetchError) {
          console.error('❌ Error fetching fulfillments for cleanup:', fetchError);
          throw fetchError;
        }

        if (batch && batch.length > 0) {
          allFulfillments = allFulfillments.concat(batch);
          hasMoreForCleanup = batch.length === cleanupBatchSize;
          cleanupOffset += cleanupBatchSize;
        } else {
          hasMoreForCleanup = false;
        }
      }

      // Group by composite key and find duplicates
      const groups = new Map();
      const duplicateIds = [];

      allFulfillments.forEach(fulfillment => {
        const key = `${fulfillment.order_id}|${fulfillment.date}|${fulfillment.country}|${fulfillment.carrier}|${fulfillment.item_count}`;

        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(fulfillment);
      });

      // Find duplicates (keep the first/oldest, mark others for deletion)
      let duplicatesFound = 0;
      groups.forEach((fulfillments, key) => {
        if (fulfillments.length > 1) {
          // Sort by created_at to keep the oldest
          fulfillments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

          // Mark all but the first for deletion
          for (let i = 1; i < fulfillments.length; i++) {
            duplicateIds.push(fulfillments[i].id);
            duplicatesFound++;
          }
        }
      });

      if (duplicatesFound === 0) {
        console.log('✅ No duplicates found');
        return {
          totalFulfillments: allFulfillments.length,
          duplicatesFound: 0,
          duplicatesRemoved: 0,
          uniqueFulfillments: allFulfillments.length
        };
      }

      // Remove duplicates in batches
      let removedCount = 0;
      const batchSize = 1000;

      for (let i = 0; i < duplicateIds.length; i += batchSize) {
        const batch = duplicateIds.slice(i, i + batchSize);

        const { error: deleteError } = await this.supabase
          .from('fulfillments')
          .delete()
          .in('id', batch);

        if (deleteError) {
          console.error('❌ Error deleting duplicates:', deleteError);
          throw deleteError;
        }

        removedCount += batch.length;
      }

      console.log(`✅ Cleanup completed: ${removedCount} duplicates removed`);

      return {
        totalFulfillments: allFulfillments.length,
        duplicatesFound: duplicatesFound,
        duplicatesRemoved: removedCount,
        uniqueFulfillments: allFulfillments.length - removedCount,
        cleanupSuccess: true
      };

    } catch (error) {
      console.error('💥 Error during cleanup:', error);
      throw error;
    }
  }
}

// CORS and API key validation
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

// Main handler function
module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  // Extract parameters
  let {
    startDate,
    endDate,
    type = 'list',
    carrier = null,
    country = null,
    limit = 1000,
    offset = 0
  } = req.query;

  // Validate and parse dates (not required for cleanup)
  if (type !== 'cleanup') {
    try {
      if (!startDate || !endDate) {
        throw new Error('startDate and endDate are required');
      }
      startDate = new Date(startDate);
      endDate = new Date(endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format');
      }
    } catch (error) {
      return res.status(400).json({
        error: error.message,
        example: {
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        }
      });
    }
  }

  try {
    const supabaseService = new SupabaseService();

    switch (type) {
      case 'list': {
        const result = await supabaseService.getFulfillments(startDate, endDate, {
          carrier,
          country,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });

        return res.status(200).json({
          success: true,
          type: 'list',
          count: result.data.length,
          data: result.data,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: result.data.length === parseInt(limit)
          },
          period: { startDate, endDate },
          filters: { carrier: carrier || 'all', country: country || 'all' },
          timestamp: new Date().toISOString()
        });
      }

      case 'analytics': {
        const result = await supabaseService.getFulfillments(startDate, endDate, {
          carrier,
          country,
          limit: 100000 // Large limit for analytics
        });

        const analytics = supabaseService.processDeliveryAnalytics(result.data);

        return res.status(200).json({
          success: true,
          type: 'analytics',
          count: result.data.length,
          data: analytics,
          period: { startDate, endDate },
          filters: { carrier: carrier || 'all', country: country || 'all' },
          timestamp: new Date().toISOString()
        });
      }

      case 'enhanced': {
        const analytics = await supabaseService.getEnhancedDeliveryAnalytics(startDate, endDate);

        return res.status(200).json({
          success: true,
          type: 'enhanced',
          count: analytics.totalFulfillments,
          data: analytics,
          period: { startDate, endDate },
          filters: { carrier: carrier || 'all', country: country || 'all' },
          timestamp: new Date().toISOString()
        });
      }

      case 'cleanup': {
        const result = await supabaseService.cleanupDuplicateFulfillments();

        return res.status(200).json({
          success: true,
          type: 'cleanup',
          message: 'Duplicate fulfillments cleanup completed',
          data: result,
          timestamp: new Date().toISOString()
        });
      }

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['list', 'analytics', 'enhanced', 'cleanup']
        });
    }

  } catch (error) {
    console.error('❌ Error in fulfillments API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};