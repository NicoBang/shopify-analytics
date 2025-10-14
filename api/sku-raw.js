// api/sku-raw.js
// CONSOLIDATED SKU endpoint combining sku-cache.js and sku-raw.js functionality
// Supports: raw data, analytics, search, and shop breakdown
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

  async getSkusForPeriod(startDate, endDate, options = {}) {
    const { shop, sku, limit = 100000, offset = 0, includeTotals = false, includeShopBreakdown = false } = options;

    // Fetch ALL data by using pagination
    let allData = [];
    let hasMore = true;
    let currentOffset = 0;
    const batchSize = 1000; // Supabase max is 1000 per request

    // If specific limit requested, use it; otherwise fetch everything
    const totalLimit = (limit && limit !== 'all') ? parseInt(limit) : 1000000;

    while (hasMore && allData.length < totalLimit) {
      const currentBatch = Math.min(batchSize, totalLimit - allData.length);

      // Build a fresh query for each batch
      let batchQuery = this.supabase
        .from('skus')
        .select('*')
        .gte('created_at_original', startDate.toISOString())
        .lte('created_at_original', endDate.toISOString())
        .order('created_at_original', { ascending: false })
        .range(currentOffset, currentOffset + currentBatch - 1);

      if (shop) {
        batchQuery = batchQuery.eq('shop', shop);
      }

      if (sku) {
        batchQuery = batchQuery.eq('sku', sku);
      }

      const { data: batchData, error: batchError } = await batchQuery;

      if (batchError) {
        console.error('❌ Database error:', batchError);
        throw batchError;
      }

      if (batchData && batchData.length > 0) {
        allData = allData.concat(batchData);
        currentOffset += batchData.length;

        console.log(`📦 Fetched batch: ${batchData.length} records, total: ${allData.length}`);

        // Continue if we got exactly the batch size (means there might be more)
        if (batchData.length < batchSize) {
          hasMore = false;
          console.log(`✅ Reached end of data (got ${batchData.length} < ${batchSize})`);
        }
      } else {
        hasMore = false;
        console.log(`✅ No more data available`);
      }
    }

    const data = allData;

    let totalCount = data?.length || 0;

    // Get total count if requested (for pagination)
    if (includeTotals && !includeShopBreakdown) {
      let countQuery = this.supabase
        .from('skus')
        .select('*', { count: 'exact', head: true })
        .gte('created_at_original', startDate.toISOString())
        .lte('created_at_original', endDate.toISOString());

      if (shop) countQuery = countQuery.eq('shop', shop);
      if (sku) countQuery = countQuery.eq('sku', sku);

      const { count: exactCount } = await countQuery;
      totalCount = exactCount || 0;
    }

    // Calculate shop breakdown if requested (for Dashboard)
    let shopBreakdown = null;
    if (includeShopBreakdown) {
      const shopMap = {};
      data.forEach(item => {
        const shopKey = item.shop || 'unknown';
        if (!shopMap[shopKey]) {
          shopMap[shopKey] = {
            shop: shopKey,
            quantitySold: 0,
            quantityCancelled: 0,
            quantityRefunded: 0,
            cancelledAmount: 0,
            revenue: 0
          };
        }

        shopMap[shopKey].quantitySold += item.quantity || 0;
        shopMap[shopKey].quantityCancelled += item.cancelled_qty || 0;
        shopMap[shopKey].quantityRefunded += item.refunded_qty || 0;
        shopMap[shopKey].cancelledAmount += item.cancelled_amount_dkk || 0;

        const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
        shopMap[shopKey].revenue += unitPriceAfterDiscount * (item.quantity || 0);
      });

      shopBreakdown = Object.values(shopMap);
    }

    return {
      data: data || [],
      totalCount,
      hasMore: (data?.length || 0) === totalLimit,
      shopBreakdown
    };
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
        discount_per_unit_dkk,
        created_at_original
      `)
      .gte('created_at_original', startDate.toISOString())
      .lte('created_at_original', endDate.toISOString())
      .order('created_at_original', { ascending: false });

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
      // price_dkk is the discounted unit price (from discountedUnitPriceSet) - includes line-level discounts
      // discount_per_unit_dkk is the order-level discount allocation per unit
      // Final price = price_dkk - discount_per_unit_dkk
      const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
      group.total_revenue += unitPriceAfterDiscount * (item.quantity || 0);
      group.order_count += 1;
      group.countries.add(item.country);
      group.shops.add(item.shop);

      const saleDate = new Date(item.created_at_original);
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

  // Extract parameters (support both GET and POST)
  let {
    startDate,
    endDate,
    type = 'raw', // Default to 'raw' for backward compatibility
    shop = null,
    sku = null,
    search = null,
    groupBy = 'sku',
    aggregateBy = null,
    limit = 10000,
    offset = 0,
    includeTotals = 'false',
    includeShopBreakdown = 'false'
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
    aggregateBy = req.body.aggregateBy || aggregateBy;
    limit = req.body.limit || limit;
    offset = req.body.offset || offset;
    includeTotals = req.body.includeTotals || includeTotals;
    includeShopBreakdown = req.body.includeShopBreakdown || includeShopBreakdown;
  }

  console.log(`🏷️ SKU request: ${type} from ${startDate} to ${endDate}${shop ? ` for ${shop}` : ''}${sku ? ` SKU: ${sku}` : ''}${search ? ` search: ${search}` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const parsedIncludeTotals = includeTotals === 'true' || includeTotals === true;
    const parsedIncludeShopBreakdown = includeShopBreakdown === 'true' || includeShopBreakdown === true;
    const parsedLimit = Math.min(parseInt(limit) || 1000, 1000000);
    const parsedOffset = parseInt(offset) || 0;

    let data, count, hasMore, shopBreakdown;

    switch (type.toLowerCase()) {
      case 'raw':
      case 'list':
        // Get raw SKU data with optional shop breakdown
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        // Convert Danish local dates to UTC accounting for timezone offset
        const start = adjustLocalDateToUTC(startDate, false);
        const end = adjustLocalDateToUTC(endDate, true);

        const result = await supabaseService.getSkusForPeriod(start, end, {
          shop,
          sku,
          limit: parsedLimit,
          offset: parsedOffset,
          includeTotals: parsedIncludeTotals,
          includeShopBreakdown: parsedIncludeShopBreakdown
        });

        data = result.data;
        count = result.totalCount;
        hasMore = result.hasMore;
        shopBreakdown = result.shopBreakdown;

        // Calculate summary statistics
        const totalQuantity = data.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const totalRefunded = data.reduce((sum, item) => sum + (item.refunded_qty || 0), 0);
        const totalCancelled = data.reduce((sum, item) => sum + (item.cancelled_qty || 0), 0);
        const totalCancelledAmount = data.reduce((sum, item) => sum + (item.cancelled_amount_dkk || 0), 0);
        const totalRevenue = data.reduce((sum, item) => {
          const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
          return sum + (unitPriceAfterDiscount * (item.quantity || 0));
        }, 0);

        // Optional artikelnummer aggregation
        let aggregatedData = null;
        if (aggregateBy === 'artikelnummer') {
          const grouped = {};

          data.forEach(item => {
            const skuValue = item.sku || '';
            const artikelnummer = skuValue.split('\\')[0] || skuValue;

            if (!grouped[artikelnummer]) {
              grouped[artikelnummer] = {
                artikelnummer: artikelnummer,
                totalQuantity: 0,
                totalRefunded: 0,
                totalRevenue: 0,
                skuCount: 0,
                records: []
              };
            }

            grouped[artikelnummer].totalQuantity += item.quantity || 0;
            grouped[artikelnummer].totalRefunded += item.refunded_qty || 0;
            const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
            grouped[artikelnummer].totalRevenue += unitPriceAfterDiscount * (item.quantity || 0);
            grouped[artikelnummer].skuCount++;
            grouped[artikelnummer].records.push({
              sku: item.sku,
              quantity: item.quantity,
              price: item.price_dkk || 0,
              shop: item.shop
            });
          });

          aggregatedData = Object.values(grouped);
          console.log(`📦 Aggregated to ${aggregatedData.length} unique artikelnummer`);
        }

        console.log(`✅ SKU raw completed: ${count} records`);

        return res.status(200).json({
          success: true,
          type,
          count,
          period: {
            startDate: start.toISOString(),
            endDate: end.toISOString()
          },
          summary: {
            totalRecords: data.length,
            totalQuantitySold: totalQuantity,
            totalQuantityRefunded: totalRefunded,
            totalQuantityCancelled: totalCancelled,
            totalCancelledAmount: parseFloat(totalCancelledAmount.toFixed(2)),
            netQuantitySold: totalQuantity - totalRefunded - totalCancelled,
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            uniqueSkus: [...new Set(data.map(item => item.sku))].length,
            uniqueOrders: [...new Set(data.map(item => item.order_id))].length,
            uniqueShops: [...new Set(data.map(item => item.shop))].length
          },
          shopBreakdown: shopBreakdown || undefined,
          aggregated: aggregatedData,
          rawData: aggregateBy ? null : data.slice(0, 100),
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset,
            hasMore,
            totalCount: parsedIncludeTotals ? count : undefined
          },
          filters: {
            shop: shop || 'all',
            sku: sku || 'all',
            aggregateBy: aggregateBy || null
          },
          timestamp: new Date().toISOString()
        });

      case 'analytics':
      case 'summary':
        // Get SKU analytics
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        // Convert Danish local dates to UTC accounting for timezone offset
        const analyticsStart = adjustLocalDateToUTC(startDate, false);
        const analyticsEnd = adjustLocalDateToUTC(endDate, true);

        data = await supabaseService.getSkuAnalytics(analyticsStart, analyticsEnd, {
          shop,
          groupBy
        });
        count = data.length;
        hasMore = false;

        console.log(`✅ SKU analytics completed: ${count} records`);

        return res.status(200).json({
          success: true,
          type,
          count,
          data: data,
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset,
            hasMore,
            totalCount: count
          },
          period: {
            startDate: analyticsStart.toISOString(),
            endDate: analyticsEnd.toISOString()
          },
          filters: {
            shop: shop || 'all',
            groupBy: groupBy
          },
          timestamp: new Date().toISOString()
        });

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

        console.log(`✅ SKU search completed: ${count} records`);

        return res.status(200).json({
          success: true,
          type,
          count,
          data: data,
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset,
            hasMore,
            totalCount: count
          },
          filters: {
            search: search
          },
          timestamp: new Date().toISOString()
        });

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['raw', 'list', 'analytics', 'summary', 'search']
        });
    }

  } catch (error) {
    console.error('💥 SKU error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      filters: { shop: shop || 'all', sku: sku || 'all', search: search || null },
      timestamp: new Date().toISOString()
    });
  }
};