// api/fulfillments.js
const { createClient } = require('@supabase/supabase-js');

// Inline SupabaseService for Vercel
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

  async getFulfillments(startDate, endDate, options = {}) {
    const { carrier, country, limit = 10000, offset = 0, includeTotals = false } = options;

    let query = this.supabase
      .from('fulfillments')
      .select('*')
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: false });

    if (carrier) {
      query = query.eq('carrier', carrier);
    }

    if (country) {
      query = query.eq('country', country);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching fulfillments:', error);
      throw error;
    }

    let totalCount = data?.length || 0;

    // Get total count if requested
    if (includeTotals) {
      let countQuery = this.supabase
        .from('fulfillments')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString());

      if (carrier) countQuery = countQuery.eq('carrier', carrier);
      if (country) countQuery = countQuery.eq('country', country);

      const { count: exactCount } = await countQuery;
      totalCount = exactCount || 0;
    }

    return { data: data || [], totalCount, hasMore: (data?.length || 0) === limit };
  }

  async getFulfillmentAnalytics(startDate, endDate, options = {}) {
    const { groupBy = 'carrier' } = options;

    const { data, error } = await this.supabase
      .from('fulfillments')
      .select('*')
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: false });

    if (error) {
      console.error('❌ Error fetching fulfillment analytics:', error);
      throw error;
    }

    return this.processFulfillmentAnalytics(data || [], groupBy);
  }

  processFulfillmentAnalytics(data, groupBy) {
    const grouped = {};
    const summary = {
      totalFulfillments: data.length,
      totalItems: 0,
      uniqueOrders: new Set(),
      dateRange: { start: null, end: null },
      carriers: new Set(),
      countries: new Set()
    };

    data.forEach(fulfillment => {
      const key = this.getFulfillmentGroupKey(fulfillment, groupBy);
      const itemCount = fulfillment.item_count || 0;
      const fulfillmentDate = new Date(fulfillment.date);

      // Update summary
      summary.totalItems += itemCount;
      summary.uniqueOrders.add(fulfillment.order_id);
      summary.carriers.add(fulfillment.carrier);
      summary.countries.add(fulfillment.country);

      if (!summary.dateRange.start || fulfillmentDate < summary.dateRange.start) {
        summary.dateRange.start = fulfillmentDate;
      }
      if (!summary.dateRange.end || fulfillmentDate > summary.dateRange.end) {
        summary.dateRange.end = fulfillmentDate;
      }

      // Group data
      if (!grouped[key]) {
        grouped[key] = {
          groupKey: key,
          fulfillmentCount: 0,
          totalItems: 0,
          uniqueOrders: new Set(),
          countries: new Set(),
          carriers: new Set(),
          firstFulfillment: null,
          lastFulfillment: null,
          avgItemsPerFulfillment: 0
        };
      }

      const group = grouped[key];
      group.fulfillmentCount++;
      group.totalItems += itemCount;
      group.uniqueOrders.add(fulfillment.order_id);
      group.countries.add(fulfillment.country);
      group.carriers.add(fulfillment.carrier);

      if (!group.firstFulfillment || fulfillmentDate < group.firstFulfillment) {
        group.firstFulfillment = fulfillmentDate;
      }
      if (!group.lastFulfillment || fulfillmentDate > group.lastFulfillment) {
        group.lastFulfillment = fulfillmentDate;
      }
    });

    // Convert sets to arrays and calculate averages
    const groupedArray = Object.values(grouped).map(group => ({
      ...group,
      uniqueOrders: group.uniqueOrders.size,
      countries: Array.from(group.countries),
      carriers: Array.from(group.carriers),
      avgItemsPerFulfillment: group.fulfillmentCount > 0 ? (group.totalItems / group.fulfillmentCount).toFixed(2) : 0
    })).sort((a, b) => b.totalItems - a.totalItems);

    // Convert summary sets to counts/arrays
    summary.uniqueOrders = summary.uniqueOrders.size;
    summary.carriers = Array.from(summary.carriers);
    summary.countries = Array.from(summary.countries);

    return {
      summary,
      groupedData: groupedArray
    };
  }

  getFulfillmentGroupKey(fulfillment, groupBy) {
    switch (groupBy) {
      case 'carrier':
        return fulfillment.carrier || 'Unknown Carrier';
      case 'country':
        return fulfillment.country || 'Unknown Country';
      case 'date':
        return fulfillment.date.split('T')[0]; // YYYY-MM-DD
      case 'week':
        const date = new Date(fulfillment.date);
        const year = date.getFullYear();
        const week = this.getWeekNumber(date);
        return `${year}-W${week.toString().padStart(2, '0')}`;
      case 'month':
        return fulfillment.date.substring(0, 7); // YYYY-MM
      default:
        return fulfillment.carrier || 'Unknown Carrier';
    }
  }

  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  async getDeliveryAnalytics(startDate, endDate) {
    // Get fulfillments with order data
    const { data: fulfillments, error } = await this.supabase
      .from('fulfillments')
      .select(`
        *,
        orders!fulfillments_order_id_fkey (
          created_at,
          shop,
          country as order_country
        )
      `)
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString());

    if (error) {
      console.error('❌ Error fetching delivery analytics:', error);
      throw error;
    }

    return this.processDeliveryAnalytics(fulfillments || []);
  }

  processDeliveryAnalytics(data) {
    const analytics = {
      totalOrders: 0,
      totalFulfillments: data.length,
      totalItems: 0,
      averageDeliveryTime: 0,
      deliveryTimes: [],
      byCarrier: {},
      byCountry: {},
      byShop: {}
    };

    data.forEach(fulfillment => {
      const orderData = fulfillment.orders;
      if (!orderData) return;

      analytics.totalOrders++;
      analytics.totalItems += fulfillment.item_count || 0;

      // Calculate delivery time
      const orderDate = new Date(orderData.created_at);
      const fulfillmentDate = new Date(fulfillment.date);
      const deliveryDays = Math.ceil((fulfillmentDate - orderDate) / (1000 * 60 * 60 * 24));

      if (deliveryDays >= 0) {
        analytics.deliveryTimes.push(deliveryDays);
      }

      // Group by carrier
      const carrier = fulfillment.carrier || 'Unknown';
      if (!analytics.byCarrier[carrier]) {
        analytics.byCarrier[carrier] = { count: 0, items: 0, deliveryTimes: [] };
      }
      analytics.byCarrier[carrier].count++;
      analytics.byCarrier[carrier].items += fulfillment.item_count || 0;
      if (deliveryDays >= 0) {
        analytics.byCarrier[carrier].deliveryTimes.push(deliveryDays);
      }

      // Group by country
      const country = fulfillment.country || 'Unknown';
      if (!analytics.byCountry[country]) {
        analytics.byCountry[country] = { count: 0, items: 0, deliveryTimes: [] };
      }
      analytics.byCountry[country].count++;
      analytics.byCountry[country].items += fulfillment.item_count || 0;
      if (deliveryDays >= 0) {
        analytics.byCountry[country].deliveryTimes.push(deliveryDays);
      }

      // Group by shop
      const shop = orderData.shop || 'Unknown';
      if (!analytics.byShop[shop]) {
        analytics.byShop[shop] = { count: 0, items: 0, deliveryTimes: [] };
      }
      analytics.byShop[shop].count++;
      analytics.byShop[shop].items += fulfillment.item_count || 0;
      if (deliveryDays >= 0) {
        analytics.byShop[shop].deliveryTimes.push(deliveryDays);
      }
    });

    // Calculate averages
    if (analytics.deliveryTimes.length > 0) {
      analytics.averageDeliveryTime = (
        analytics.deliveryTimes.reduce((sum, days) => sum + days, 0) /
        analytics.deliveryTimes.length
      ).toFixed(1);
    }

    // Calculate averages for each group
    ['byCarrier', 'byCountry', 'byShop'].forEach(groupType => {
      Object.values(analytics[groupType]).forEach(group => {
        if (group.deliveryTimes.length > 0) {
          group.averageDeliveryTime = (
            group.deliveryTimes.reduce((sum, days) => sum + days, 0) /
            group.deliveryTimes.length
          ).toFixed(1);
        } else {
          group.averageDeliveryTime = 0;
        }
        delete group.deliveryTimes; // Remove array to reduce response size
      });
    });

    delete analytics.deliveryTimes; // Remove array to reduce response size

    return analytics;
  }

  async upsertFulfillments(fulfillments) {
    if (!fulfillments || fulfillments.length === 0) return { count: 0 };

    console.log(`🚚 Upserting ${fulfillments.length} fulfillments to Supabase...`);

    const { data, error } = await this.supabase
      .from('fulfillments')
      .upsert(fulfillments, {
        onConflict: 'order_id,date',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting fulfillments:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${fulfillments.length} fulfillments`);
    return { count: fulfillments.length, data };
  }
}

// Enable CORS and verify API key
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
    groupBy = 'carrier',
    limit = 10000,
    offset = 0,
    includeTotals = 'false'
  } = req.query;

  // Support POST for data
  if (req.method === 'POST' && req.body) {
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    type = req.body.type || type;
    carrier = req.body.carrier || carrier;
    country = req.body.country || country;
    groupBy = req.body.groupBy || groupBy;
    limit = req.body.limit || limit;
    offset = req.body.offset || offset;
    includeTotals = req.body.includeTotals || includeTotals;
  }

  console.log(`🚚 Fulfillments request: ${type} from ${startDate} to ${endDate}${carrier ? ` carrier: ${carrier}` : ''}${country ? ` country: ${country}` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const parsedIncludeTotals = includeTotals === 'true' || includeTotals === true;
    const parsedLimit = Math.min(parseInt(limit) || 1000, 5000);
    const parsedOffset = parseInt(offset) || 0;

    let data, count, hasMore;

    switch (type.toLowerCase()) {
      case 'list':
      case 'raw':
        // Get fulfillment data
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const result = await supabaseService.getFulfillments(start, end, {
          carrier,
          country,
          limit: parsedLimit,
          offset: parsedOffset,
          includeTotals: parsedIncludeTotals
        });

        data = result.data;
        count = result.totalCount;
        hasMore = result.hasMore;
        break;

      case 'analytics':
      case 'summary':
        // Get fulfillment analytics
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const analyticsStart = new Date(startDate);
        const analyticsEnd = new Date(endDate);

        data = await supabaseService.getFulfillmentAnalytics(analyticsStart, analyticsEnd, {
          groupBy
        });
        count = data.summary.totalFulfillments;
        hasMore = false;
        break;

      case 'delivery':
        // Get delivery analytics with timing
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const deliveryStart = new Date(startDate);
        const deliveryEnd = new Date(endDate);

        data = await supabaseService.getDeliveryAnalytics(deliveryStart, deliveryEnd);
        count = data.totalFulfillments;
        hasMore = false;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['list', 'raw', 'analytics', 'summary', 'delivery']
        });
    }

    console.log(`✅ Fulfillments completed: ${count} records`);

    // Format response for Google Sheets compatibility
    let responseData = data;

    if (type === 'list' && Array.isArray(data)) {
      // Convert to Google Sheets format (array of arrays)
      responseData = data.map(item => [
        item.order_id,
        item.date,
        item.country,
        item.carrier,
        item.item_count
      ]);
    }

    // Return success response
    return res.status(200).json({
      success: true,
      type,
      count,
      data: responseData,
      pagination: type === 'list' ? {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore,
        totalCount: parsedIncludeTotals ? count : undefined
      } : undefined,
      period: startDate && endDate ? {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      } : undefined,
      filters: {
        carrier: carrier || 'all',
        country: country || 'all',
        groupBy: ['analytics', 'summary'].includes(type) ? groupBy : undefined
      },
      timestamp: new Date().toISOString(),
      ...(type === 'list' && responseData.length > 0 ? {
        headers: ['Order ID', 'Date', 'Country', 'Carrier', 'Item Count']
      } : {})
    });

  } catch (error) {
    console.error('💥 Fulfillments error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      filters: { carrier: carrier || 'all', country: country || 'all' },
      timestamp: new Date().toISOString()
    });
  }
};