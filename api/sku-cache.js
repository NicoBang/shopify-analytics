// api/sku-cache.js
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

  async getSkusForPeriod(startDate, endDate, options = {}) {
    const { shop, sku, limit = 100000, offset = 0, includeTotals = false } = options;

    let query = this.supabase
      .from('skus')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (shop) {
      query = query.eq('shop', shop);
    }

    if (sku) {
      query = query.eq('sku', sku);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ Error fetching SKUs:', error);
      throw error;
    }

    let totalCount = data?.length || 0;

    // Get total count if requested (for pagination)
    if (includeTotals) {
      let countQuery = this.supabase
        .from('skus')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (shop) countQuery = countQuery.eq('shop', shop);
      if (sku) countQuery = countQuery.eq('sku', sku);

      const { count: exactCount } = await countQuery;
      totalCount = exactCount || 0;
    }

    return { data: data || [], totalCount, hasMore: (data?.length || 0) === limit };
  }

  async getSkuAnalytics(startDate, endDate, options = {}) {
    const { shop, groupBy = 'sku' } = options;

    let query = this.supabase
      .from('skus')
      .select(`
        sku,
        shop,
        product_title,
        variant_title,
        country,
        quantity,
        refunded_qty,
        price_dkk,
        created_at
      `)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (shop) {
      query = query.eq('shop', shop);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching SKU analytics:', error);
      throw error;
    }

    // Process data for analytics
    const analytics = this.processSkuAnalytics(data || [], groupBy);

    return analytics;
  }

  processSkuAnalytics(data, groupBy) {
    const grouped = {};

    data.forEach(item => {
      const key = this.getGroupKey(item, groupBy);

      if (!grouped[key]) {
        grouped[key] = {
          groupKey: key,
          sku: item.sku,
          product_title: item.product_title,
          variant_title: item.variant_title,
          total_quantity: 0,
          total_refunded: 0,
          total_revenue: 0,
          order_count: 0,
          countries: new Set(),
          shops: new Set(),
          first_sale: null,
          last_sale: null
        };
      }

      const group = grouped[key];
      group.total_quantity += item.quantity || 0;
      group.total_refunded += item.refunded_qty || 0;
      group.total_revenue += (item.price_dkk || 0) * (item.quantity || 0);
      group.order_count += 1;
      group.countries.add(item.country);
      group.shops.add(item.shop);

      const saleDate = new Date(item.created_at);
      if (!group.first_sale || saleDate < group.first_sale) {
        group.first_sale = saleDate;
      }
      if (!group.last_sale || saleDate > group.last_sale) {
        group.last_sale = saleDate;
      }
    });

    // Convert sets to arrays and format data
    return Object.values(grouped).map(group => ({
      ...group,
      countries: Array.from(group.countries),
      shops: Array.from(group.shops),
      net_quantity: group.total_quantity - group.total_refunded,
      avg_price: group.total_quantity > 0 ? group.total_revenue / group.total_quantity : 0,
      refund_rate: group.total_quantity > 0 ? (group.total_refunded / group.total_quantity * 100) : 0
    })).sort((a, b) => b.total_revenue - a.total_revenue);
  }

  getGroupKey(item, groupBy) {
    switch (groupBy) {
      case 'sku':
        return item.sku;
      case 'product':
        return item.product_title || 'Unknown Product';
      case 'variant':
        return `${item.product_title} - ${item.variant_title}`;
      case 'shop':
        return item.shop;
      case 'country':
        return item.country || 'Unknown';
      default:
        return item.sku;
    }
  }

  async searchSkus(searchTerm, options = {}) {
    const { limit = 100, includeMetadata = false } = options;

    let query = this.supabase
      .from('skus')
      .select('sku, product_title, variant_title, shop')
      .or(`sku.ilike.%${searchTerm}%,product_title.ilike.%${searchTerm}%,variant_title.ilike.%${searchTerm}%`)
      .limit(limit);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error searching SKUs:', error);
      throw error;
    }

    // Remove duplicates and format
    const uniqueSkus = [];
    const seen = new Set();

    (data || []).forEach(item => {
      if (!seen.has(item.sku)) {
        seen.add(item.sku);
        uniqueSkus.push({
          sku: item.sku,
          product_title: item.product_title,
          variant_title: item.variant_title,
          shops: [item.shop] // Could aggregate if needed
        });
      }
    });

    return uniqueSkus;
  }
}

// Enable CORS and verify API key
function validateRequest(req, res) {
  // Enable CORS for Google Sheets
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify API key
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }

  return null; // Valid request
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  // Extract parameters
  let {
    startDate,
    endDate,
    type = 'list',
    shop = null,
    sku = null,
    search = null,
    groupBy = 'sku',
    limit = 10000,
    offset = 0,
    includeTotals = 'false'
  } = req.query;

  // Also support POST body parameters
  if (req.method === 'POST' && req.body) {
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    type = req.body.type || type;
    shop = req.body.shop || shop;
    sku = req.body.sku || sku;
    search = req.body.search || search;
    groupBy = req.body.groupBy || groupBy;
    limit = req.body.limit || limit;
    offset = req.body.offset || offset;
    includeTotals = req.body.includeTotals || includeTotals;
  }

  console.log(`🏷️ SKU Cache request: ${type} from ${startDate} to ${endDate}${shop ? ` for ${shop}` : ''}${sku ? ` SKU: ${sku}` : ''}${search ? ` search: ${search}` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const parsedIncludeTotals = includeTotals === 'true' || includeTotals === true;
    const parsedLimit = Math.min(parseInt(limit) || 1000, 5000); // Max 5000 for performance
    const parsedOffset = parseInt(offset) || 0;

    let data, count, hasMore;

    switch (type.toLowerCase()) {
      case 'list':
      case 'raw':
        // Get raw SKU data with pagination
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const result = await supabaseService.getSkusForPeriod(start, end, {
          shop,
          sku,
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
        // Get SKU analytics
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const analyticsStart = new Date(startDate);
        const analyticsEnd = new Date(endDate);

        data = await supabaseService.getSkuAnalytics(analyticsStart, analyticsEnd, {
          shop,
          groupBy
        });
        count = data.length;
        hasMore = false;
        break;

      case 'search':
        // Search SKUs
        if (!search) {
          return res.status(400).json({
            error: 'Missing required parameter: search',
            example: { search: 'ABC123' }
          });
        }

        data = await supabaseService.searchSkus(search, {
          limit: parsedLimit
        });
        count = data.length;
        hasMore = false;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['list', 'raw', 'analytics', 'summary', 'search']
        });
    }

    console.log(`✅ SKU Cache completed: ${count} records`);

    // Format response for Google Sheets compatibility
    let responseData = data;

    if (type === 'list' && Array.isArray(data)) {
      // Convert to Google Sheets format (array of arrays)
      responseData = data.map(item => [
        item.shop,
        item.order_id,
        item.sku,
        item.created_at,
        item.country,
        item.product_title,
        item.variant_title,
        item.quantity,
        item.refunded_qty,
        item.price_dkk,
        item.refund_date
      ]);
    }

    // Return success response
    return res.status(200).json({
      success: true,
      type,
      count,
      data: responseData,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore,
        totalCount: parsedIncludeTotals ? count : undefined
      },
      period: startDate && endDate ? {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      } : undefined,
      filters: {
        shop: shop || 'all',
        sku: sku || 'all',
        search: search || null,
        groupBy: type === 'analytics' ? groupBy : undefined
      },
      timestamp: new Date().toISOString(),
      ...(type === 'list' && responseData.length > 0 ? {
        headers: [
          'Shop', 'Order ID', 'SKU', 'Created At', 'Country',
          'Product Title', 'Variant Title', 'Quantity', 'Refunded Qty',
          'Price DKK', 'Refund Date'
        ]
      } : {})
    });

  } catch (error) {
    console.error('💥 SKU Cache error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      filters: { shop: shop || 'all', sku: sku || 'all', search: search || null },
      timestamp: new Date().toISOString()
    });
  }
};