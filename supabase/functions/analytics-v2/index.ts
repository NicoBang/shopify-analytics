// analytics-v2 Edge Function - Pre-aggregated dashboard metrics from daily_shop_metrics table
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const API_SECRET_KEY = Deno.env.get('API_SECRET_KEY') || '';

class SupabaseService {
  supabase: any;

  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }

  async getDashboardFromAggregatedMetrics(startDate: Date, endDate: Date, shop: string | null = null) {
    // Shop sort order: DA, DE, NL, INT, CHF
    const SHOP_ORDER: Record<string, number> = {
      'pompdelux-da.myshopify.com': 1,
      'pompdelux-de.myshopify.com': 2,
      'pompdelux-nl.myshopify.com': 3,
      'pompdelux-int.myshopify.com': 4,
      'pompdelux-chf.myshopify.com': 5
    };

    // CRITICAL: daily_shop_metrics.metric_date is ALREADY in Danish calendar date format
    // Google Sheets sends UTC timestamps representing Danish time
    // We need to extract the Danish calendar date by adding the correct offset
    // CEST (summer): UTC+2 (last Sunday March 02:00 to last Sunday October 03:00)
    // CET (winter): UTC+1 (rest of year)

    // Helper: Check if a date is in Danish Summer Time (CEST)
    function isDanishSummerTime(utcTimestamp: Date): boolean {
      const date = new Date(utcTimestamp);
      const year = date.getUTCFullYear();

      // Find last Sunday of March
      const marchLastDay = new Date(Date.UTC(year, 2, 31, 1, 0, 0)); // March 31 01:00 UTC
      const marchLastSunday = new Date(marchLastDay);
      marchLastSunday.setUTCDate(31 - marchLastDay.getUTCDay());

      // Find last Sunday of October
      const octoberLastDay = new Date(Date.UTC(year, 9, 31, 1, 0, 0)); // Oct 31 01:00 UTC
      const octoberLastSunday = new Date(octoberLastDay);
      octoberLastSunday.setUTCDate(31 - octoberLastDay.getUTCDay());

      return date >= marchLastSunday && date < octoberLastSunday;
    }

    // Extract Danish calendar date by adding correct offset
    const startOffset = isDanishSummerTime(startDate) ? 2 : 1;
    const endOffset = isDanishSummerTime(endDate) ? 2 : 1;

    console.log(`🔍 DEBUG: Incoming UTC timestamps:`);
    console.log(`   Start: ${startDate.toISOString()} (DST=${isDanishSummerTime(startDate)}, offset=${startOffset}h)`);
    console.log(`   End: ${endDate.toISOString()} (DST=${isDanishSummerTime(endDate)}, offset=${endOffset}h)`);

    const dateStart = new Date(startDate.getTime() + startOffset * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateEnd = new Date(endDate.getTime() + endOffset * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`⚡ Fetching pre-aggregated metrics: ${dateStart} to ${dateEnd}`);

    // Query pre-aggregated data with PAGINATION (Supabase default limit is 1000 rows)
    // For 12 months * 5 shops = ~1825 rows, we need pagination!
    const allData: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('daily_shop_metrics')
        .select('*')
        .gte('metric_date', dateStart)
        .lte('metric_date', dateEnd)
        .order('metric_date', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (shop) {
        query = query.eq('shop', shop);
      }

      const { data: batch, error } = await query;

      if (error) {
        console.error('❌ Error fetching aggregated metrics:', error);
        throw error;
      }

      if (batch && batch.length > 0) {
        allData.push(...batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
        if (hasMore) {
          console.log(`  Fetched ${offset} daily metrics, continuing...`);
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`  Total daily metrics fetched: ${allData.length}`);

    if (!allData || allData.length === 0) {
      console.warn('⚠️ No aggregated data found');
      return [];
    }

    const data = allData;

    // Aggregate metrics per shop across all days
    const shopMetrics: Record<string, any> = {};

    data.forEach((row: any) => {
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
          orderDiscounts: 0,
          saleDiscounts: 0,
          totalDiscounts: 0,
          cancelledQty: 0
        };
      }

      const m = shopMetrics[row.shop];
      // CRITICAL: revenue_gross = (price * qty) - cancelled_amount (NO discounts yet!)
      // Bruttoomsætning = revenue_gross - order_discount_total - cancelled_amount
      const revenueGross = parseFloat(row.revenue_gross) || 0;
      const orderDiscountTotal = parseFloat(row.order_discount_total) || 0;
      const saleDiscountTotal = parseFloat(row.sale_discount_total) || 0;
      const cancelledAmount = parseFloat(row.cancelled_amount) || 0;

      m.bruttoomsætning += revenueGross - orderDiscountTotal - cancelledAmount;
      m.nettoomsætning += parseFloat(row.revenue_net) || 0;
      m.stkBrutto += row.sku_quantity_gross || 0;
      m.stkNetto += row.sku_quantity_net || 0;
      m.antalOrdrer += row.order_count || 0;
      m.returQty += row.return_quantity || 0;
      m.refundedAmount += parseFloat(row.return_amount) || 0;
      m.returOrderCount += row.return_order_count || 0;
      m.shipping += parseFloat(row.shipping_revenue) || 0;
      m.orderDiscounts += orderDiscountTotal;
      m.saleDiscounts += saleDiscountTotal;
      m.totalDiscounts += orderDiscountTotal + saleDiscountTotal;
      m.cancelledQty += row.cancelled_quantity || 0;
    });

    // Calculate derived metrics
    const result = Object.values(shopMetrics).map((shop: any) => {
      // Nettoomsætning = bruttoomsætning - return_amount
      const nettoomsætning = shop.bruttoomsætning - shop.refundedAmount;

      const ordreværdi = shop.antalOrdrer > 0 ? shop.bruttoomsætning / shop.antalOrdrer : 0;
      const basketSize = shop.antalOrdrer > 0 ? shop.stkBrutto / shop.antalOrdrer : 0;
      const stkPris = shop.stkBrutto > 0 ? shop.bruttoomsætning / shop.stkBrutto : 0;
      const returStkPct = shop.stkBrutto > 0 ? (shop.returQty / shop.stkBrutto) * 100 : 0;
      const returKrPct = shop.bruttoomsætning > 0 ? (shop.refundedAmount / shop.bruttoomsætning) * 100 : 0;
      const returOrdrePct = shop.antalOrdrer > 0 ? (shop.returOrderCount / shop.antalOrdrer) * 100 : 0;
      const fragtPct = shop.bruttoomsætning > 0 ? (shop.shipping / shop.bruttoomsætning) * 100 : 0;

      return {
        ...shop,
        nettoomsætning: nettoomsætning,
        gnstOrdreværdi: ordreværdi,
        basketSize: basketSize,
        gnsStkpris: stkPris,
        returPctStk: returStkPct,
        returPctKr: returKrPct,
        returPctOrdre: returOrdrePct,
        fragtPctAfOms: fragtPct
      };
    });

    // Sort by shop order: DA, DE, NL, INT, CHF
    result.sort((a, b) => {
      const orderA = SHOP_ORDER[a.shop] || 999;
      const orderB = SHOP_ORDER[b.shop] || 999;
      return orderA - orderB;
    });

    console.log(`✅ Aggregated metrics: ${result.length} shops, ${data.length} daily records`);
    return result;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify API key
    const authHeader = req.headers.get('Authorization') || '';
    const apiKey = authHeader.replace('Bearer ', '');

    if (apiKey !== API_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const url = new URL(req.url);
    const startDateStr = url.searchParams.get('startDate');
    const endDateStr = url.searchParams.get('endDate');
    const shop = url.searchParams.get('shop');
    const type = url.searchParams.get('type') || 'dashboard-sku';

    if (!startDateStr || !endDateStr) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: startDate, endDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return new Response(
        JSON.stringify({ error: 'Invalid date format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📊 analytics-v2 request: ${type}, ${startDateStr} to ${endDateStr}, shop: ${shop || 'all'}`);

    const service = new SupabaseService();
    let data: any;

    // Route based on type parameter
    if (type === "dashboard" || type === "dashboard-sku") {
      data = await service.getDashboardFromAggregatedMetrics(start, end, shop);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown type: ${type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return data in Vercel-compatible format
    const result = {
      success: true,
      data: data,
      count: data.length,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Error in analytics-v2:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
