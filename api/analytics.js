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
      } else {
        hasMore = false;
      }
    }

    return allOrders;
  }

  async getOrdersRefundedInPeriod(startDate, endDate, shop = null) {
    // Fetch orders where refund_date falls within the period (returns dated by refund date)
    let query = this.supabase
      .from('orders')
      .select('*')
      .not('refund_date', 'is', null)
      .gte('refund_date', startDate.toISOString())
      .lte('refund_date', endDate.toISOString())
      .order('refund_date', { ascending: false });

    if (shop) {
      query = query.eq('shop', shop);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching refunded orders:', error);
      throw error;
    }

    return data || [];
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

  async getDashboardFromSkus(startDate, endDate, shop = null) {
    // Aggregate dashboard data from SKUs table using same logic as Style Analytics
    // This fixes the qty calculation issue by using consistent date filtering

    // STEP 1: Get SKUs created in period (sales)
    let salesQuery = this.supabase
      .from('skus')
      .select('shop, quantity, cancelled_qty, price_dkk, created_at, refund_date, refunded_qty')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (shop) {
      salesQuery = salesQuery.eq('shop', shop);
    }

    const { data: salesData, error: salesError } = await salesQuery;
    if (salesError) {
      console.error('❌ Error fetching SKU sales:', salesError);
      throw salesError;
    }

    // STEP 2: Get SKUs with refund_date in period (returns)
    let refundQuery = this.supabase
      .from('skus')
      .select('shop, quantity, cancelled_qty, price_dkk, created_at, refund_date, refunded_qty')
      .not('refund_date', 'is', null)
      .gte('refund_date', startDate.toISOString())
      .lte('refund_date', endDate.toISOString());

    if (shop) {
      refundQuery = refundQuery.eq('shop', shop);
    }

    const { data: refundData, error: refundError } = await refundQuery;
    if (refundError) {
      console.error('❌ Error fetching SKU refunds:', refundError);
      throw refundError;
    }


    // STEP 3: Aggregate by shop
    const shopMap = {};
    const shopNames = ['pompdelux-da.myshopify.com', 'pompdelux-de.myshopify.com', 'pompdelux-nl.myshopify.com', 'pompdelux-int.myshopify.com', 'pompdelux-chf.myshopify.com'];

    shopNames.forEach(s => {
      shopMap[s] = {
        stkBrutto: 0,    // quantity - cancelled_qty from sales
        stkNetto: 0,     // stkBrutto - refunded items from period
        returQty: 0,     // refunded_qty from period
        omsætning: 0     // revenue calculation
      };
    });

    // Process sales data
    (salesData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      const quantity = Number(item.quantity) || 0;
      const cancelled = Number(item.cancelled_qty) || 0;
      const bruttoQty = Math.max(0, quantity - cancelled);

      shopMap[shop].stkBrutto += bruttoQty;
      shopMap[shop].stkNetto += bruttoQty; // Start with brutto quantity, then subtract refunds

      // Only count refunds if they happened in the same period
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= startDate &&
        new Date(item.refund_date) <= endDate;

      if (hasRefundInPeriod) {
        const refunded = Number(item.refunded_qty) || 0;
        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;
      }
    });

    // Process return data (returns from orders created outside period)
    (refundData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      // Check if this item was already counted in sales
      const wasCountedInSales = item.created_at &&
        new Date(item.created_at) >= startDate &&
        new Date(item.created_at) <= endDate;

      if (!wasCountedInSales) {
        // This is a return from an older order - only count the return
        const refunded = Number(item.refunded_qty) || 0;
        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;
      }
    });

    // Build result array in same format as original Dashboard
    const result = [];

    shopNames.forEach(shop => {
      const data = shopMap[shop];
      result.push({
        shop: shop,
        stkBrutto: data.stkBrutto,
        stkNetto: data.stkNetto,
        returQty: data.returQty
      });
    });

    return result;
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
  let { startDate, endDate, type = 'dashboard', shop = null, includeReturns = 'false' } = req.query;

  // Also support POST body parameters
  if (req.method === 'POST' && req.body) {
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    type = req.body.type || type;
    shop = req.body.shop || shop;
    includeReturns = String(req.body.includeReturns ?? includeReturns);
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


  try {
    const supabaseService = new SupabaseService();

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Normalize includeReturns once for use across handler
    const wantsReturns = String(includeReturns) === 'true';

    let data, rows, count;
    let returnRows = [];

    switch (type.toLowerCase()) {
      case 'dashboard-sku':
        // SKU-based dashboard aggregation for accurate quantity calculations
        data = await supabaseService.getDashboardFromSkus(start, end, shop);
        break;

      case 'dashboard':
      case 'orders':
        // Get order data for Google Sheets format
        const orders = await supabaseService.getOrdersForPeriod(start, end, shop);
        // Build cancelled_qty map from SKUs if missing/zero on orders
        const orderIds = (orders || []).map(o => o.order_id).filter(Boolean);
        const cancelledByOrder = {};
        // Helper to aggregate in chunks to avoid IN() limits
        const chunkSize = 1000;
        for (let i = 0; i < orderIds.length; i += chunkSize) {
          const chunk = orderIds.slice(i, i + chunkSize);
          if (chunk.length === 0) continue;
          const { data: skuChunk, error: skuErr } = await supabaseService.supabase
            .from('skus')
            .select('order_id,cancelled_qty')
            .in('order_id', chunk);
          if (skuErr) {
            console.warn('⚠️ Could not aggregate cancelled_qty from skus:', skuErr.message);
            break;
          }
          (skuChunk || []).forEach(r => {
            const k = r.order_id;
            const v = Number(r.cancelled_qty) || 0;
            if (!cancelledByOrder[k]) cancelledByOrder[k] = 0;
            cancelledByOrder[k] += v;
          });
        }
        if (wantsReturns) {
          const refundedOrders = await supabaseService.getOrdersRefundedInPeriod(start, end, shop);
          // Map refunded orders to the same row structure if requested
          returnRows = refundedOrders.map(order => [
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
            (order.cancelled_qty && order.cancelled_qty > 0)
              ? order.cancelled_qty
              : (cancelledByOrder[order.order_id] || 0),
            order.sale_discount_total || 0,
            order.combined_discount_total || 0
          ]);
        }

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
          (order.cancelled_qty && order.cancelled_qty > 0)
            ? order.cancelled_qty
            : (cancelledByOrder[order.order_id] || 0),
          order.sale_discount_total || 0,
          order.combined_discount_total || 0
        ]);

        count = rows.length;
        data = { rows, headers: [
          'Shop', 'Order ID', 'Created At', 'Country', 'Discounted Total',
          'Tax', 'Shipping', 'Item Count', 'Refunded Amount', 'Refunded Qty',
          'Refund Date', 'Total Discounts Ex Tax', 'Cancelled Qty', 'Sale Discount Total', 'Combined Discount Total'
        ] };
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


    // Return success response
    const baseResponse = {
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
    };

    if (type.toLowerCase() === 'orders') {
      // For orders, optionally include returns at top-level for dashboard logic
      baseResponse.returns = wantsReturns ? returnRows : undefined;
    }

    return res.status(200).json(baseResponse);

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