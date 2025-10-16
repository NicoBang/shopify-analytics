// api/analytics.js
const { createClient } = require('@supabase/supabase-js');
const { adjustLocalDateToUTC } = require('./timezone-utils');

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

  /**
   * Get dashboard data from pre-aggregated daily_shop_metrics table
   * ⚡ ULTRA-FAST: <2 seconds for any date range
   */
  async getDashboardFromAggregatedMetrics(startDate, endDate, shop = null) {
    // CRITICAL: daily_shop_metrics.metric_date is ALREADY in Danish calendar date format
    // Google Sheets sends UTC timestamps representing Danish time:
    //   16/10/2024 00:00 Danish = 2024-10-15T22:00:00Z UTC (start)
    //   16/10/2024 23:59 Danish = 2024-10-16T21:59:59Z UTC (end)
    // We need: metric_date='2024-10-16' (the Danish calendar date already stored in DB)
    // Solution: Add offset to start (to get from 15th to 16th), but NOT to end (already 16th)
    const danishOffset = 2 * 60 * 60 * 1000;
    const dateStart = new Date(startDate.getTime() + danishOffset).toISOString().split('T')[0];
    const dateEnd = endDate.toISOString().split('T')[0]; // NO offset for end date!

    console.log(`⚡ Fetching pre-aggregated metrics: ${dateStart} to ${dateEnd}`);

    // Query pre-aggregated data (super fast - just SUM a few hundred rows max)
    let query = this.supabase
      .from('daily_shop_metrics')
      .select('*')
      .gte('metric_date', dateStart)
      .lte('metric_date', dateEnd);

    if (shop) {
      query = query.eq('shop', shop);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching aggregated metrics:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No aggregated data found - falling back to real-time calculation');
      return null; // Will trigger fallback to getDashboardMetricsFromSkus
    }

    // Aggregate metrics per shop across all days
    const shopMetrics = {};

    data.forEach(row => {
      if (!shopMetrics[row.shop]) {
        shopMetrics[row.shop] = {
          shop: row.shop,
          bruttoomsætning: 0,
          nettoomsætning: 0,
          stkBrutto: 0,
          stkNetto: 0,
          antalOrdrer: 0,
          returQty: 0,
          refundedAmount: 0,
          returOrderCount: 0,
          shipping: 0,
          totalDiscounts: 0,
          cancelledQty: 0
        };
      }

      const m = shopMetrics[row.shop];
      m.bruttoomsætning += parseFloat(row.revenue_gross) || 0;
      m.nettoomsætning += parseFloat(row.revenue_net) || 0;
      m.stkBrutto += row.sku_quantity_gross || 0;
      m.stkNetto += row.sku_quantity_net || 0;
      m.antalOrdrer += row.order_count || 0;
      m.returQty += row.return_quantity || 0;
      m.refundedAmount += parseFloat(row.return_amount) || 0;
      m.returOrderCount += row.return_order_count || 0;
      m.shipping += parseFloat(row.shipping_revenue) || 0;
      m.totalDiscounts += parseFloat(row.total_discounts) || 0;
      m.cancelledQty += row.cancelled_quantity || 0;
    });

    // Calculate derived metrics
    const result = Object.values(shopMetrics).map(shop => {
      const ordreværdi = shop.antalOrdrer > 0 ? shop.bruttoomsætning / shop.antalOrdrer : 0;
      const basketSize = shop.antalOrdrer > 0 ? shop.stkBrutto / shop.antalOrdrer : 0;
      const stkPris = shop.stkBrutto > 0 ? shop.bruttoomsætning / shop.stkBrutto : 0;
      const returStkPct = shop.stkBrutto > 0 ? (shop.returQty / shop.stkBrutto) * 100 : 0;
      const returKrPct = shop.bruttoomsætning > 0 ? (shop.refundedAmount / shop.bruttoomsætning) * 100 : 0;
      const returOrdrePct = shop.antalOrdrer > 0 ? (shop.returOrderCount / shop.antalOrdrer) * 100 : 0;
      const fragtPct = shop.bruttoomsætning > 0 ? (shop.shipping / shop.bruttoomsætning) * 100 : 0;

      return {
        ...shop,
        gnstOrdreværdi: ordreværdi,
        basketSize: basketSize,
        gnsStkpris: stkPris,
        returPctStk: returStkPct,
        returPctKr: returKrPct,
        returPctOrdre: returOrdrePct,
        fragtPctAfOms: fragtPct
      };
    });

    console.log(`✅ Aggregated metrics: ${result.length} shops, ${data.length} daily records`);
    return result;
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
        .select('shop, order_id, shipping_price_dkk, shipping_discount_dkk, shipping_refund_dkk, refund_date, refunded_amount')
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

    // STEP 2.6: Get shipping refunds from orders with refund_date in period - WITH PAGINATION
    const shippingRefundsData = [];
    let shippingRefundsOffset = 0;
    let hasMoreShippingRefunds = true;

    while (hasMoreShippingRefunds) {
      let shippingRefundsQuery = this.supabase
        .from('orders')
        .select('shop, order_id, shipping_refund_dkk, refund_date')
        .not('refund_date', 'is', null)
        .gt('shipping_refund_dkk', 0)  // Only orders with actual shipping refunds
        .gte('refund_date', startDate.toISOString())
        .lte('refund_date', endDate.toISOString())
        .order('refund_date', { ascending: false })
        .range(shippingRefundsOffset, shippingRefundsOffset + batchSize - 1);

      if (shop) {
        shippingRefundsQuery = shippingRefundsQuery.eq('shop', shop);
      }

      const { data: shippingRefundsBatch, error: shippingRefundsError } = await shippingRefundsQuery;
      if (shippingRefundsError) {
        console.error('❌ Error fetching shipping refunds:', shippingRefundsError);
        throw shippingRefundsError;
      }

      if (shippingRefundsBatch && shippingRefundsBatch.length > 0) {
        shippingRefundsData.push(...shippingRefundsBatch);
        hasMoreShippingRefunds = shippingRefundsBatch.length === batchSize;
        shippingRefundsOffset += batchSize;
      } else {
        hasMoreShippingRefunds = false;
      }
    }

    console.log('📊 DEBUG [getDashboardFromSkus] Shipping refunds fetched:', shippingRefundsData.length);

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

      // Calculate shipping revenue: shipping_price_dkk - shipping_discount_dkk (both already EX VAT)
      const shippingPrice = Number(order.shipping_price_dkk) || 0;
      const shippingDiscount = Number(order.shipping_discount_dkk) || 0;
      const shippingRevenue = shippingPrice - shippingDiscount;

      shopMap[shop].shipping += shippingRevenue;

      // Subtract shipping refund if refund_date is in period (regardless of order creation date)
      const refundDate = order.refund_date;
      const shippingRefund = Number(order.shipping_refund_dkk) || 0;
      if (refundDate && shippingRefund > 0) {
        const refundDateObj = new Date(refundDate);
        if (refundDateObj >= startDate && refundDateObj <= endDate) {
          shopMap[shop].shipping -= shippingRefund;
        }
      }

      // Track orders with returns
      const refundedAmount = Number(order.refunded_amount) || 0;
      if (refundedAmount > 0 && order.order_id) {
        shopMap[shop].returnOrderIds.add(order.order_id);
      }
    });

    // Process shipping refunds (refund_date in period, from orders NOT created in period)
    console.log('📊 DEBUG [getDashboardFromSkus] Processing shipping refunds data:', shippingRefundsData.length);
    (shippingRefundsData || []).forEach(order => {
      const shop = order.shop;
      if (!shopMap[shop]) return;

      // Check if order was already processed in ordersData (avoid double-counting)
      const orderCreatedInPeriod = ordersData.some(o => o.order_id === order.order_id);

      console.log(`📊 DEBUG [shipping refund] Order ${order.order_id}: createdInPeriod=${orderCreatedInPeriod}, refund=${order.shipping_refund_dkk}`);

      if (!orderCreatedInPeriod) {
        // This is a shipping refund from an older order - subtract it
        const shippingRefund = Number(order.shipping_refund_dkk) || 0;
        shopMap[shop].shipping -= shippingRefund;
        console.log(`✅ Subtracted ${shippingRefund} DKK shipping refund from ${shop} (order ${order.order_id})`);
      } else {
        console.log(`⚠️ Skipped shipping refund (order already in ordersData): ${order.order_id}`);
      }
      // If order was created in period, shipping_refund_dkk was already subtracted above
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

      // ✅ FIXED: Calculate cancelled_amount if missing (matches Color_Analytics logic)
      let cancelledAmount = Number(item.cancelled_amount_dkk) || 0;
      if (cancelledAmount === 0 && cancelled > 0) {
        // If cancelled_amount_dkk is 0 but cancelled_qty > 0, calculate it
        cancelledAmount = pricePerUnit * cancelled;
      }

      // Track total discounts (order-level + sale discounts, both ex. moms)
      const discountPerUnit = Number(item.discount_per_unit_dkk) || 0;
      const saleDiscountPerUnit = Number(item.sale_discount_per_unit_dkk) || 0;
      const totalDiscountPerUnit = discountPerUnit + saleDiscountPerUnit;
      shopMap[shop].totalDiscounts += totalDiscountPerUnit * quantity;

      // ✅ CRITICAL: price_dkk is ALREADY the discounted price (after sale discount)
      // Only subtract order-level discounts (discount_per_unit_dkk), NOT sale discounts!
      const orderDiscountAmount = discountPerUnit * quantity;
      const bruttoRevenue = totalPrice - orderDiscountAmount - cancelledAmount;

      shopMap[shop].bruttoomsætning += bruttoRevenue;
      shopMap[shop].nettoomsætning += bruttoRevenue; // Start with brutto, then subtract refunds

      // Only count refunds if they happened in the same period
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= startDate &&
        new Date(item.refund_date) <= endDate;

      if (hasRefundInPeriod) {
        const refunded = Number(item.refunded_qty) || 0;
        const refundedAmount = Number(item.refunded_amount_dkk) || 0;

        // returQty tæller KUN refunded items (ikke cancelled, da de allerede er trukket fra på order_created dagen)
        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;  // FIXED: Kun refunded, ikke cancelled
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

        // returQty tæller KUN refunded items (cancelled blev allerede trukket fra på order_created dagen)
        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;  // FIXED: Kun refunded, ikke cancelled
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
        returOrderCount: returOrderCount, // ✅ NEW: Antal ordrer med refunds
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

    // Convert Danish local dates to UTC accounting for timezone offset
    // Example: 2024-10-01 (Danish) → 2024-09-30T22:00:00Z (UTC, CEST +2)
    // This ensures orders created 00:00-02:00 Danish time are included
    const start = adjustLocalDateToUTC(startDate, false); // Start of day in UTC
    const end = adjustLocalDateToUTC(endDate, true);     // End of day in UTC (next day 22:00:00Z)

    // Normalize includeReturns once for use across handler
    const wantsReturns = String(includeReturns) === 'true';

    let data, rows, count;
    let returnRows = [];

    switch (type.toLowerCase()) {
      case 'dashboard-sku':
        // ⚡ ULTRA-FAST: Try pre-aggregated metrics first
        data = await supabaseService.getDashboardFromAggregatedMetrics(start, end, shop);

        // Fallback to real-time calculation if no aggregated data exists
        if (!data) {
          console.log('⏱️ Fallback to real-time SKU aggregation');
          data = await supabaseService.getDashboardFromSkus(start, end, shop);
        }
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