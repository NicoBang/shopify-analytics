// Supabase Edge Function: api-analytics
// Converted from Vercel API route: api/analytics.js
// Handles dashboard analytics aggregation from orders and SKUs tables

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Timezone adjustment helper (imported from timezone-utils)
function adjustLocalDateToUTC(dateStr: string, isEndOfDay: boolean): Date {
  // Convert Danish local date to UTC
  // Example: 2024-10-01 (Danish CEST) → 2024-09-30T22:00:00Z (UTC)
  const localDate = new Date(dateStr);
  const offsetHours = isEndOfDay ? -2 : -2; // CEST = UTC+2

  if (isEndOfDay) {
    localDate.setHours(23, 59, 59, 999);
  } else {
    localDate.setHours(0, 0, 0, 0);
  }

  // Adjust for timezone offset
  const utcDate = new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
  return utcDate;
}

// Supabase Service class (same logic as Vercel version)
class SupabaseService {
  private supabase;

  constructor() {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async getDashboardFromSkus(startDate: Date, endDate: Date, shop: string | null = null) {
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
        hasMoreRefunds = refundBatch.length === batchSize;
        refundOffset += batchSize;
      } else {
        hasMoreRefunds = false;
      }
    }

    console.log('📊 DEBUG [getDashboardFromSkus] Refund data fetched:', refundData.length);

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
        .gt('shipping_refund_dkk', 0)
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
    const shopMap: Record<string, any> = {};
    const shopNames = ['pompdelux-da.myshopify.com', 'pompdelux-de.myshopify.com', 'pompdelux-nl.myshopify.com', 'pompdelux-int.myshopify.com', 'pompdelux-chf.myshopify.com'];

    shopNames.forEach(s => {
      shopMap[s] = {
        stkBrutto: 0,
        stkNetto: 0,
        returQty: 0,
        bruttoomsætning: 0,
        nettoomsætning: 0,
        refundedAmount: 0,
        orderIds: new Set(),
        returnOrderIds: new Set(),
        totalDiscounts: 0,
        cancelledQty: 0,
        shipping: 0
      };
    });

    // Process orders data first (for shipping and order count)
    (ordersData || []).forEach(order => {
      const shop = order.shop;
      if (!shopMap[shop]) return;

      if (order.order_id) {
        shopMap[shop].orderIds.add(order.order_id);
      }

      const shippingPrice = Number(order.shipping_price_dkk) || 0;
      const shippingDiscount = Number(order.shipping_discount_dkk) || 0;
      const shippingRevenue = shippingPrice - shippingDiscount;

      shopMap[shop].shipping += shippingRevenue;

      const refundDate = order.refund_date;
      const shippingRefund = Number(order.shipping_refund_dkk) || 0;
      if (refundDate && shippingRefund > 0) {
        const refundDateObj = new Date(refundDate);
        if (refundDateObj >= startDate && refundDateObj <= endDate) {
          shopMap[shop].shipping -= shippingRefund;
        }
      }

      const refundedAmount = Number(order.refunded_amount) || 0;
      if (refundedAmount > 0 && order.order_id) {
        shopMap[shop].returnOrderIds.add(order.order_id);
      }
    });

    // Process shipping refunds
    (shippingRefundsData || []).forEach(order => {
      const shop = order.shop;
      if (!shopMap[shop]) return;

      const orderCreatedInPeriod = ordersData.some(o => o.order_id === order.order_id);

      if (!orderCreatedInPeriod) {
        const shippingRefund = Number(order.shipping_refund_dkk) || 0;
        shopMap[shop].shipping -= shippingRefund;
      }
    });

    // Process sales data
    (salesData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      const quantity = Number(item.quantity) || 0;
      const cancelled = Number(item.cancelled_qty) || 0;
      const bruttoQty = quantity - cancelled;

      shopMap[shop].stkBrutto += bruttoQty;
      shopMap[shop].stkNetto += bruttoQty;
      shopMap[shop].cancelledQty += cancelled;

      const pricePerUnit = Number(item.price_dkk) || 0;
      const totalPrice = pricePerUnit * quantity;

      let cancelledAmount = Number(item.cancelled_amount_dkk) || 0;
      if (cancelledAmount === 0 && cancelled > 0) {
        cancelledAmount = pricePerUnit * cancelled;
      }

      const discountPerUnit = Number(item.discount_per_unit_dkk) || 0;
      const saleDiscountPerUnit = Number(item.sale_discount_per_unit_dkk) || 0;
      const totalDiscountPerUnit = discountPerUnit + saleDiscountPerUnit;
      shopMap[shop].totalDiscounts += totalDiscountPerUnit * quantity;

      const orderDiscountAmount = discountPerUnit * quantity;
      const bruttoRevenue = totalPrice - orderDiscountAmount - cancelledAmount;

      shopMap[shop].bruttoomsætning += bruttoRevenue;
      shopMap[shop].nettoomsætning += bruttoRevenue;

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

        if (refunded > 0 && item.order_id) {
          shopMap[shop].returnOrderIds.add(item.order_id);
        }
      }
    });

    // Process return data
    (refundData || []).forEach(item => {
      const shop = item.shop;
      if (!shopMap[shop]) return;

      const wasCountedInSales = item.created_at_original &&
        new Date(item.created_at_original) >= startDate &&
        new Date(item.created_at_original) <= endDate;

      if (!wasCountedInSales) {
        const refunded = Number(item.refunded_qty) || 0;
        const refundedAmount = Number(item.refunded_amount_dkk) || 0;

        shopMap[shop].stkNetto -= refunded;
        shopMap[shop].returQty += refunded;
        shopMap[shop].nettoomsætning -= refundedAmount;
        shopMap[shop].refundedAmount += refundedAmount;

        if (refunded > 0 && item.order_id) {
          shopMap[shop].returnOrderIds.add(item.order_id);
        }
      }
    });

    // Build result array
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
        returOrderCount: returOrderCount,
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

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify API key
    const authHeader = req.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");
    const expectedKey = Deno.env.get("API_SECRET_KEY");

    if (!apiKey || apiKey !== expectedKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse query parameters
    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const type = url.searchParams.get("type") || "dashboard";
    const shop = url.searchParams.get("shop");
    const includeReturns = url.searchParams.get("includeReturns") || "false";

    if (!startDate || !endDate) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameters: startDate and endDate",
          example: { startDate: "2024-01-01", endDate: "2024-12-31" }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize service
    const service = new SupabaseService();

    // Convert Danish dates to UTC
    const start = adjustLocalDateToUTC(startDate, false);
    const end = adjustLocalDateToUTC(endDate, true);

    // Route to appropriate analytics method based on type
    let data;

    if (type === "dashboard" || type === "dashboard-sku") {
      // Dashboard analytics from SKUs table (same logic as Vercel)
      data = await service.getDashboardFromSkus(start, end, shop);
    } else {
      // Unknown type - return error
      return new Response(
        JSON.stringify({
          error: `Unknown analytics type: ${type}`,
          supportedTypes: ["dashboard", "dashboard-sku"],
          example: { type: "dashboard-sku" }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Wrap in Vercel-compatible response format
    const result = {
      success: true,
      data: data,
      count: data.length,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Analytics error:", error);

    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
