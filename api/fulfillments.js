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

  // Enhanced delivery analytics - now using refund data from fulfillments table
  async getEnhancedDeliveryAnalytics(startDate, endDate) {
    console.log(`🚚 Enhanced Delivery Analytics: ${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`);

    // ✅ CRITICAL: Fetch fulfillments where EITHER date OR refund_date is in period
    // This ensures we get:
    // 1. Fulfillments that happened in the period (for fulfilled count)
    // 2. Refunds that happened in the period (even if fulfillment was earlier)

    let allFulfillments = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    while (hasMore) {
      // ✅ FIXED: Fetch fulfillments where EITHER delivery happened OR refund happened in period
      // This ensures we track:
      // 1. Deliveries in period (for fulfillment count)
      // 2. Refunds in period (for return count, even if delivery was earlier)
      const { data: batch, error: batchError } = await this.supabase
        .from('fulfillments')
        .select('*')
        .or(`and(date.gte.${startISO},date.lte.${endISO}),and(refund_date.gte.${startISO},refund_date.lte.${endISO})`)
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

    console.log(`✅ Fetched ${allFulfillments.length} total fulfillments (by date OR refund_date)`);

    // Calculate enhanced metrics - refund data now comes from fulfillments table
    return this.calculateEnhancedDeliveryMetrics(
      allFulfillments || [],
      startDate,
      endDate
    );
  }

  // Simplified metrics using refund data from fulfillments table
  async calculateEnhancedDeliveryMetrics(fulfillmentData, startDate, endDate) {
    const fulfillmentMatrix = {};
    const returnsMatrix = {};
    const carriers = new Set();
    const countries = new Set();
    const returnCountries = new Set();
    let totalFulfillments = 0;
    let totalFulfilledItems = 0;
    let totalReturnedItems = 0;
    let totalReturns = 0;

    // Process fulfillments and returns from single table
    fulfillmentData.forEach(fulfillment => {
      const key = `${fulfillment.country}|${fulfillment.carrier}`;
      const fulfillmentDate = new Date(fulfillment.date);

      // ✅ Track fulfillments ONLY if delivery happened in period
      if (fulfillmentDate >= startDate && fulfillmentDate <= endDate) {
        countries.add(fulfillment.country);
        carriers.add(fulfillment.carrier);
        fulfillmentMatrix[key] = (fulfillmentMatrix[key] || 0) + 1;
        totalFulfillments++;
        totalFulfilledItems += Number(fulfillment.item_count) || 0;
      }

      // ✅ Track returns ONLY if refund happened in period
      // CRITICAL: Google Sheets sends UTC timestamps that represent Danish dates
      if (fulfillment.refund_date) {
        const refundDate = new Date(fulfillment.refund_date);

        // Compare timestamps directly (no string conversion - avoids timezone issues)
        if (refundDate >= startDate && refundDate <= endDate) {
          returnCountries.add(fulfillment.country);
          returnsMatrix[key] = (returnsMatrix[key] || 0) + 1;
          totalReturns++;
          totalReturnedItems += Number(fulfillment.refunded_qty) || 0;
        }
      }
    });

    console.log(`✅ Processed: ${totalFulfillments} fulfillments, ${totalReturns} returns, ${totalReturnedItems} items returned`);

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
        : '0%'
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