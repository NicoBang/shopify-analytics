// api/analytics.js
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

  async getOrdersForPeriod(startDate, endDate, shop = null) {
    // Fetch ALL orders using pagination to overcome Supabase 1000 limit
    const allOrders = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('orders')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (shop) {
        query = query.eq('shop', shop);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching orders:', error);
        throw error;
      }

      if (data && data.length > 0) {
        allOrders.push(...data);
        hasMore = data.length === batchSize;
        offset += batchSize;

        console.log(`📊 Fetched ${data.length} orders (total: ${allOrders.length})`);
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Total orders fetched: ${allOrders.length}`);
    return allOrders;
  }

  async getAnalytics(startDate, endDate) {
    const { data, error } = await this.supabase
      .from('order_analytics')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('❌ Error fetching analytics:', error);
      throw error;
    }

    return data || [];
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
  let { startDate, endDate, type = 'dashboard', shop = null } = req.query;

  // Also support POST body parameters
  if (req.method === 'POST' && req.body) {
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    type = req.body.type || type;
    shop = req.body.shop || shop;
  }

  if (!startDate || !endDate) {
    return res.status(400).json({
      error: 'Missing required parameters: startDate and endDate',
      example: {
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      }
    });
  }

  console.log(`📊 Analytics request: ${type} from ${startDate} to ${endDate}${shop ? ` for ${shop}` : ''}`);

  try {
    const supabaseService = new SupabaseService();

    const start = new Date(startDate);
    const end = new Date(endDate);

    let data, rows, count;

    switch (type.toLowerCase()) {
      case 'dashboard':
      case 'orders':
        // Get order data for Google Sheets format
        const orders = await supabaseService.getOrdersForPeriod(start, end, shop);

        // Transform data for Google Sheets (array of arrays)
        rows = orders.map(order => [
          order.shop,
          order.order_id,
          order.created_at,
          order.country,
          order.discounted_total || 0,
          order.tax || 0,
          order.shipping || 0,
          order.item_count || 0,
          order.refunded_amount || 0,
          order.refunded_qty || 0,
          order.refund_date || '',
          order.total_discounts_ex_tax || 0,
          order.cancelled_qty || 0,
          order.sale_discount_total || 0,
          order.combined_discount_total || 0
        ]);

        count = rows.length;
        data = { rows, headers: [
          'Shop', 'Order ID', 'Created At', 'Country', 'Discounted Total',
          'Tax', 'Shipping', 'Item Count', 'Refunded Amount', 'Refunded Qty',
          'Refund Date', 'Total Discounts Ex Tax', 'Cancelled Qty', 'Sale Discount Total', 'Combined Discount Total'
        ]};
        break;

      case 'analytics':
      case 'summary':
        // Get aggregated analytics data
        const analytics = await supabaseService.getAnalytics(start, end);

        rows = analytics.map(row => [
          row.shop,
          row.date,
          row.order_count || 0,
          row.total_revenue || 0,
          row.total_refunded || 0,
          row.avg_order_value || 0
        ]);

        count = rows.length;
        data = { rows, headers: [
          'Shop', 'Date', 'Order Count', 'Total Revenue', 'Total Refunded', 'Avg Order Value'
        ]};
        break;

      case 'raw':
        // Return raw data as JSON (not for Google Sheets)
        const rawOrders = await supabaseService.getOrdersForPeriod(start, end, shop);
        data = rawOrders;
        count = rawOrders.length;
        rows = null;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid analytics type',
          validTypes: ['dashboard', 'orders', 'analytics', 'summary', 'raw']
        });
    }

    console.log(`✅ Analytics completed: ${count} records`);

    // Return success response
    return res.status(200).json({
      success: true,
      type,
      count,
      data: rows || data, // Use rows for Google Sheets, data for raw JSON
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString()
      },
      shop: shop || 'all',
      timestamp: new Date().toISOString(),
      ...(rows ? { headers: data.headers } : {})
    });

  } catch (error) {
    console.error('💥 Analytics error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      period: { startDate, endDate },
      shop: shop || 'all',
      timestamp: new Date().toISOString()
    });
  }
};