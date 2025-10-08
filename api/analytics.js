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
        .order('order_id', { ascending: false })
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
    // Fetch ALL orders with refund_date in period using pagination
    const allReturns = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('orders')
        .select('*')
        .not('refund_date', 'is', null)
        .gte('refund_date', startDate.toISOString())
        .lte('refund_date', endDate.toISOString())
        .order('refund_date', { ascending: false })
        .order('order_id', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (shop) {
        query = query.eq('shop', shop);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching refunded orders:', error);
        throw error;
      }

      if (data && data.length > 0) {
        allReturns.push(...data);
        hasMore = data.length === batchSize;
        offset += batchSize;
      } else {
        hasMore = false;
      }
    }

    return allReturns;
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

    console.log('🔍 DEBUG [getDashboardFromSkus] Start:', { startDate: startDate.toISOString(), endDate: endDate.toISOString(), shop });

    // STEP 1: Get ALL SKUs created in period (sales) - WITH PAGINATION
    const salesData = [];
    let salesOffset = 0;
    const batchSize = 1000;
    let hasMoreSales = true;

    while (hasMoreSales) {
      let salesQuery = this.supabase
        .from('skus')
        .select('shop, order_id, quantity, cancelled_qty, price_dkk, created_at_original, refund_date, refunded_qty, refunded_amount_dkk, cancelled_amount_dkk, discount_per_unit_dkk, sale_discount_per_unit_dkk')
        .gte('created_at_original', startDate.toISOString())
        .lte('created_at_original', endDate.toISOString())
        .order('created_at_original', { ascending: false })
        .range(salesOffset, salesOffset + batchSize - 1);

      if (shop) {
        salesQuery = salesQuery.eq('shop', shop);
      }

      const { data: salesBatch, error: salesError } = await salesQuery;
      if (salesError) {
        console.error('❌ Error fetching SKU sales:', salesError);
        throw salesError;
      }

      if (salesBatch && salesBatch.length > 0) {
        salesData.push(...salesBatch);
        hasMoreSales = salesBatch.length === batchSize;
        salesOffset += batchSize;
      } else {
        hasMoreSales = false;
      }
    }

    console.log('📊 DEBUG [getDashboardFromSkus] Sales data fetched:', salesData.length);

    // STEP 2: Get ALL SKUs with refund_date in period (returns) - WITH PAGINATION
    const refundData = [];
    let refundOffset = 0;
    let hasMoreRefunds = true;
    let lastRefundBatchSize = 0;

    while (hasMoreRefunds) {
      let refundQuery = this.supabase
        .from('skus')
        .select('shop, order_id, quantity, cancelled_qty, price_dkk, created_at_original, refund_date, refunded_qty, refunded_amount_dkk, cancelled_amount_dkk, discount_per_unit_dkk, sale_discount_per_unit_dkk')
        .not('refund_date', 'is', null)
        .gte('refund_date', startDate.toISOString())
        .lte('refund_date', endDate.toISOString())
        .order('refund_date', { ascending: false })
        .range(refundOffset, refundOffset + batchSize - 1);

      if (shop) {
        refundQuery = refundQuery.eq('shop', shop);
      }

      const { data: refundBatch, error: refundError } = await refundQuery;
      if (refundError) {
        console.error('❌ Error fetching SKU refunds:', refundError);
        throw refundError;
      }

      if (refundBatch && refundBatch.length > 0) {
        refundData.push(...refundBatch);
        lastRefundBatchSize = refundBatch.length;
        hasMoreRefunds = refundBatch.length === batchSize;
        refundOffset += batchSize;
      } else {
        hasMoreRefunds = false;
      }
    }

    console.log('📊 DEBUG [getDashboardFromSkus] Refund data fetched:', refundData.length);
    console.log('📦 DEBUG [getDashboardFromSkus] Last refund batch size:', lastRefundBatchSize);

    // STEP 2.5: Get orders for shipping data - WITH PAGINATION
    const ordersData = [];
    let ordersOffset = 0;
    let hasMoreOrders = true;

    while (hasMoreOrders) {
      let ordersQuery = this.supabase
        .from('orders')
        .select('shop, order_id, shipping, refunded_amount')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(ordersOffset, ordersOffset + batchSize - 1);

      if (shop) {
        ordersQuery = ordersQuery.eq('shop', shop);
      }

      const { data: ordersBatch, error: ordersError } = await ordersQuery;
      if (ordersError) {
        console.error('❌ Error fetching orders:', ordersError);
        throw ordersError;
      }

      if (ordersBatch && ordersBatch.length > 0) {
        ordersData.push(...ordersBatch);
        hasMoreOrders = ordersBatch.length === batchSize;
        ordersOffset += batchSize;
      } else {
        hasMoreOrders = false;
      }
    }

    // STEP 3: Aggregate by shop
    const shopMap = {};
    const shopNames = ['pompdelux-da.myshopify.com', 'pompdelux-de.myshopify.com', 'pompdelux-nl.myshopify.com', 'pompdelux-int.myshopify.com', 'pompdelux-chf.myshopify.com'];

    shopNames.forEach(s => {
      shopMap[s] = {
        stkBrutto: 0,           // quantity - cancelled_qty from sales
        stkNetto: 0,            // stkBrutto - refunded items from period
        returQty: 0,            // refunded_qty from period
        bruttoomsætning: 0,     // total_price_dkk - cancelled_amount_dkk
        nettoomsætning: 0,      // bruttoomsætning - refunded_amount_dkk
        refundedAmount: 0,      // refunded_amount_dkk from period
        orderIds: new Set(),    // unique order_id count for antalOrdrer (from orders table)
        returnOrderIds: new Set(), // unique order_ids with returns
        totalDiscounts: 0,      // SUM(discount_per_unit_dkk * quantity)
        cancelledQty: 0,        // SUM(cancelled_qty)
        shipping: 0             // SUM(shipping) from orders table
      };
    });

    // Process orders data first (for shipping and order count)
    (ordersData || []).forEach(order => {
      const shop = order.shop;
      if (!shopMap[shop]) return;

      // Track unique order IDs from orders table (more efficient)
      if (order.order_id) {
        shopMap[shop].orderIds.add(order.order_id);
      }

      // Calculate shipping ex. tax using dynamic tax rate
      // discounted_total = items_inkl_tax + shipping_inkl_tax
      // tax = total tax (items + shipping)
      const shipping = Number(order.shipping) || 0;
      const discountedTotal = Number(order.discounted_total) || 0;
      const tax = Number(order.tax) || 0;

      let shippingExTax = 0;
      if (shipping > 0 && discountedTotal > 0 && tax > 0) {
        // Calculate tax rate: tax_rate = tax / (discounted_total - tax)
        const itemsAndShippingExTax = discountedTotal - tax;
        const taxRate = itemsAndShippingExTax > 0 ? tax / itemsAndShippingExTax : 0.25;

        // shipping_ex_tax = shipping / (1 + tax_rate)
        shippingExTax = shipping / (1 + taxRate);
      } else if (shipping > 0) {
        // Fallback: assume 25% tax if we can't calculate
        shippingExTax = shipping / 1.25;
      }

      shopMap[shop].shipping += shippingExTax;

      // Track orders with returns
      const refundedAmount = Number(order.refunded_amount) || 0;
      if (refundedAmount > 0 && order.order_id) {
        shopMap[shop].returnOrderIds.add(order.order_id);
      }
    });

    // DEBUG: Track refund metrics before processing
    let totalRefundedQtyBeforeFilter = 0;
    let refundsOutsidePeriod = 0;
    let refundsInPeriodFromSales = 0;

    // Calculate total refunded_qty from salesData BEFORE filtering
    (salesData || []).forEach(item => {
      const refunded = Number(item.refunded_qty) || 0;
      totalRefundedQtyBeforeFilter += refunded;
    });

    // Calculate total refunded_qty from refundData BEFORE filtering
    (refundData || []).forEach(item => {
      const refunded = Number(item.refunded_qty) || 0;
      totalRefundedQtyBeforeFilter += refunded;
    });

    console.log('📊 DEBUG [getDashboardFromSkus] Total refunded_qty BEFORE filtering:', totalRefundedQtyBeforeFilter);

    // Process sales data
    (salesData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      const quantity = Number(item.quantity) || 0;
      const cancelled = Number(item.cancelled_qty) || 0;
      const bruttoQty = quantity - cancelled;  // Brutto = quantity minus cancelled

      shopMap[shop].stkBrutto += bruttoQty;
      shopMap[shop].stkNetto += bruttoQty; // Start with brutto quantity, then subtract refunds
      shopMap[shop].cancelledQty += cancelled;

      // Revenue calculation (Updated October 2025: using price_dkk * quantity instead of total_price_dkk)
      const pricePerUnit = Number(item.price_dkk) || 0;
      const totalPrice = pricePerUnit * quantity;
      const cancelledAmount = Number(item.cancelled_amount_dkk) || 0;
      const bruttoRevenue = totalPrice - cancelledAmount;

      shopMap[shop].bruttoomsætning += bruttoRevenue;
      shopMap[shop].nettoomsætning += bruttoRevenue; // Start with brutto, then subtract refunds

      // Track total discounts (order-level + sale discounts, both ex. moms)
      const discountPerUnit = Number(item.discount_per_unit_dkk) || 0;
      const saleDiscountPerUnit = Number(item.sale_discount_per_unit_dkk) || 0;
      const totalDiscountPerUnit = discountPerUnit + saleDiscountPerUnit;
      shopMap[shop].totalDiscounts += totalDiscountPerUnit * quantity;

      // Only count refunds if they happened in the same period
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= startDate &&
        new Date(item.refund_date) <= endDate;

      if (hasRefundInPeriod) {
        const refunded = Number(item.refunded_qty) || 0;
        const refundedAmount = Number(item.refunded_amount_dkk) || 0;

        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;
        shopMap[shop].nettoomsætning -= refundedAmount;
        shopMap[shop].refundedAmount += refundedAmount;
        refundsInPeriodFromSales += refunded;

        // Track order with return (if not already tracked from orders table)
        if (refunded > 0 && item.order_id) {
          shopMap[shop].returnOrderIds.add(item.order_id);
        }
      } else if (item.refund_date) {
        // Refund exists but outside period
        const refunded = Number(item.refunded_qty) || 0;
        refundsOutsidePeriod += refunded;
      }
    });

    console.log('📊 DEBUG [getDashboardFromSkus] Refunds in period (from sales):', refundsInPeriodFromSales);
    console.log('🚫 DEBUG [getDashboardFromSkus] Refunds outside period boundaries:', refundsOutsidePeriod);

    // Process return data (returns from orders created outside period)
    let refundsFilteredByDoubleCount = 0;
    let refundsAddedFromRefundData = 0;

    (refundData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      // Check if this item was already counted in sales
      const wasCountedInSales = item.created_at_original &&
        new Date(item.created_at_original) >= startDate &&
        new Date(item.created_at_original) <= endDate;

      if (!wasCountedInSales) {
        // This is a return from an older order - only count the return
        const refunded = Number(item.refunded_qty) || 0;
        const refundedAmount = Number(item.refunded_amount_dkk) || 0;

        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;
        shopMap[shop].nettoomsætning -= refundedAmount;
        shopMap[shop].refundedAmount += refundedAmount;
        refundsAddedFromRefundData += refunded;

        // Track order with return (if not already tracked from orders table)
        if (refunded > 0 && item.order_id) {
          shopMap[shop].returnOrderIds.add(item.order_id);
        }
      } else {
        // Already counted in sales - this is the "double-counting prevention"
        const refunded = Number(item.refunded_qty) || 0;
        refundsFilteredByDoubleCount += refunded;
      }
    });

    console.log('✅ DEBUG [getDashboardFromSkus] Refunds added from refund-only data:', refundsAddedFromRefundData);
    console.log('🚫 DEBUG [getDashboardFromSkus] Refunds filtered (double-counting):', refundsFilteredByDoubleCount);

    // Calculate total refunds AFTER filtering
    const totalRefundsAfterFilter = refundsInPeriodFromSales + refundsAddedFromRefundData;
    console.log('📊 DEBUG [getDashboardFromSkus] Total refunded_qty AFTER filtering:', totalRefundsAfterFilter);
    console.log('🔍 DEBUG [getDashboardFromSkus] Difference (before - after):', totalRefundedQtyBeforeFilter - totalRefundsAfterFilter);

    // Build result array with revenue data
    const result = [];

    shopNames.forEach(shop => {
      const data = shopMap[shop];
      const antalOrdrer = data.orderIds.size;
      const brutto = Math.round(data.bruttoomsætning * 100) / 100;
      const netto = Math.round(data.nettoomsætning * 100) / 100;
      const stkBrutto = data.stkBrutto;

      const shipping = Math.round(data.shipping * 100) / 100;
      const returOrderCount = data.returnOrderIds.size;

      result.push({
        shop: shop,
        antalOrdrer: antalOrdrer,
        stkBrutto: stkBrutto,
        stkNetto: data.stkNetto,
        returQty: data.returQty,
        bruttoomsætning: brutto,
        nettoomsætning: netto,
        refundedAmount: Math.round(data.refundedAmount * 100) / 100,
        totalDiscounts: Math.round(data.totalDiscounts * 100) / 100,
        cancelledQty: data.cancelledQty,
        shipping: shipping,
        // Afledte værdier
        gnstOrdreværdi: antalOrdrer > 0 ? Math.round((brutto / antalOrdrer) * 100) / 100 : 0,
        basketSize: antalOrdrer > 0 ? Math.round((stkBrutto / antalOrdrer) * 10) / 10 : 0,
        gnsStkpris: stkBrutto > 0 ? Math.round((brutto / stkBrutto) * 100) / 100 : 0,
        returPctStk: stkBrutto > 0 ? Math.round((data.returQty / stkBrutto) * 10000) / 100 : 0,
        returPctKr: brutto > 0 ? Math.round((data.refundedAmount / brutto) * 10000) / 100 : 0,
        returPctOrdre: antalOrdrer > 0 ? Math.round((returOrderCount / antalOrdrer) * 10000) / 100 : 0,
        fragtPctAfOms: brutto > 0 ? Math.round((shipping / brutto) * 10000) / 100 : 0
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

    // Ensure full day coverage (same logic as sku-raw.js)
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

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