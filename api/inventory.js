// api/inventory.js
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

  async getInventory(options = {}) {
    const { sku, search, limit = 10000, offset = 0, includeTotals = false } = options;

    let query = this.supabase
      .from('inventory')
      .select('*')
      .order('last_updated', { ascending: false });

    if (sku) {
      query = query.eq('sku', sku);
    }

    if (search) {
      query = query.ilike('sku', `%${search}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching inventory:', error);
      throw error;
    }

    let totalCount = data?.length || 0;

    // Get total count if requested
    if (includeTotals) {
      let countQuery = this.supabase
        .from('inventory')
        .select('*', { count: 'exact', head: true });

      if (sku) countQuery = countQuery.eq('sku', sku);
      if (search) countQuery = countQuery.ilike('sku', `%${search}%`);

      const { count: exactCount } = await countQuery;
      totalCount = exactCount || 0;
    }

    return { data: data || [], totalCount, hasMore: (data?.length || 0) === limit };
  }

  async getInventoryWithMetadata(options = {}) {
    const { sku, search, limit = 10000, offset = 0 } = options;

    let query = this.supabase
      .from('inventory_with_metadata')
      .select('*')
      .order('last_updated', { ascending: false });

    if (sku) {
      query = query.eq('sku', sku);
    }

    if (search) {
      query = query.ilike('sku', `%${search}%`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching inventory with metadata:', error);
      // Fallback to basic inventory if view doesn't exist yet
      console.log('📝 Falling back to basic inventory query...');
      return this.getInventoryBasic(options);
    }

    return data || [];
  }

  async getInventoryBasic(options = {}) {
    const { sku, search, limit = 10000, offset = 0 } = options;

    let query = this.supabase
      .from('inventory')
      .select('*')
      .order('last_updated', { ascending: false });

    if (sku) {
      query = query.eq('sku', sku);
    }

    if (search) {
      query = query.ilike('sku', `%${search}%`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching basic inventory:', error);
      throw error;
    }

    return data || [];
  }

  async getInventoryAnalytics(options = {}) {
    const { lowStockThreshold = 10, groupBy = 'status' } = options;

    // Get basic inventory data
    const { data, error } = await this.supabase
      .from('inventory')
      .select('*');

    if (error) {
      console.error('❌ Error fetching inventory analytics:', error);
      throw error;
    }

    return this.processBasicInventoryAnalytics(data || [], { lowStockThreshold });
  }

  processBasicInventoryAnalytics(data, options) {
    const { lowStockThreshold } = options;

    const summary = {
      totalSkus: data.length,
      totalQuantity: 0,
      lowStock: 0,
      outOfStock: 0,
      activeProducts: data.length, // Assume all are active without metadata
      totalValue: 0 // Cannot calculate without cost data
    };

    data.forEach(item => {
      const quantity = item.quantity || 0;

      summary.totalQuantity += quantity;

      if (quantity <= 0) {
        summary.outOfStock++;
      } else if (quantity <= lowStockThreshold) {
        summary.lowStock++;
      }
    });

    return {
      summary,
      groupedData: [
        {
          groupKey: 'All Products',
          count: summary.totalSkus,
          totalQuantity: summary.totalQuantity,
          totalValue: summary.totalValue,
          lowStock: summary.lowStock,
          outOfStock: summary.outOfStock
        }
      ]
    };
  }

  processInventoryAnalytics(data, options) {
    const { lowStockThreshold, groupBy } = options;

    const summary = {
      totalSkus: data.length,
      totalQuantity: 0,
      lowStock: 0,
      outOfStock: 0,
      activeProducts: 0,
      totalValue: 0,
      groupedData: {}
    };

    data.forEach(item => {
      const quantity = item.quantity || 0;
      const metadata = item.product_metadata || {};
      const cost = parseFloat(metadata.cost) || 0;

      summary.totalQuantity += quantity;
      summary.totalValue += cost * quantity;

      if (quantity <= 0) {
        summary.outOfStock++;
      } else if (quantity <= lowStockThreshold) {
        summary.lowStock++;
      }

      if (metadata.status === 'ACTIVE') {
        summary.activeProducts++;
      }

      // Group data
      const groupKey = this.getInventoryGroupKey(item, groupBy);
      if (!summary.groupedData[groupKey]) {
        summary.groupedData[groupKey] = {
          groupKey,
          count: 0,
          totalQuantity: 0,
          totalValue: 0,
          lowStock: 0,
          outOfStock: 0
        };
      }

      const group = summary.groupedData[groupKey];
      group.count++;
      group.totalQuantity += quantity;
      group.totalValue += cost * quantity;

      if (quantity <= 0) group.outOfStock++;
      else if (quantity <= lowStockThreshold) group.lowStock++;
    });

    // Convert grouped data to array and sort
    summary.groupedData = Object.values(summary.groupedData)
      .sort((a, b) => b.totalValue - a.totalValue);

    return summary;
  }

  getInventoryGroupKey(item, groupBy) {
    const metadata = item.product_metadata || {};

    switch (groupBy) {
      case 'status':
        return metadata.status || 'Unknown';
      case 'program':
        return metadata.program || 'Unknown';
      case 'produkt':
        return metadata.produkt || 'Unknown';
      case 'farve':
        return metadata.farve || 'Unknown';
      case 'season':
        return metadata.season || 'Unknown';
      case 'gender':
        return metadata.gender || 'Unknown';
      case 'størrelse':
        return metadata.størrelse || 'Unknown';
      default:
        return metadata.status || 'Unknown';
    }
  }

  async updateInventory(inventoryData) {
    if (!inventoryData || inventoryData.length === 0) {
      return { count: 0 };
    }

    console.log(`📦 Updating ${inventoryData.length} inventory items...`);

    const { data, error } = await this.supabase
      .from('inventory')
      .upsert(inventoryData, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error updating inventory:', error);
      throw error;
    }

    console.log(`✅ Successfully updated ${inventoryData.length} inventory items`);
    return { count: inventoryData.length, data };
  }
}

// Enable CORS and verify API key
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
    type = 'list',
    sku = null,
    search = null,
    groupBy = 'status',
    limit = 10000,
    offset = 0,
    includeTotals = 'false',
    lowStockThreshold = 10,
    includeMetadata = 'false'
  } = req.query;

  // Support POST for updates
  if (req.method === 'POST' && req.body) {
    type = req.body.type || type;
    sku = req.body.sku || sku;
    search = req.body.search || search;
    groupBy = req.body.groupBy || groupBy;
    limit = req.body.limit || limit;
    offset = req.body.offset || offset;
    includeTotals = req.body.includeTotals || includeTotals;
    lowStockThreshold = req.body.lowStockThreshold || lowStockThreshold;
    includeMetadata = req.body.includeMetadata || includeMetadata;
  }

  console.log(`📦 Inventory request: ${type}${sku ? ` SKU: ${sku}` : ''}${search ? ` search: ${search}` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const parsedIncludeTotals = includeTotals === 'true' || includeTotals === true;
    const parsedIncludeMetadata = includeMetadata === 'true' || includeMetadata === true;
    const parsedLimit = Math.min(parseInt(limit) || 1000, 5000);
    const parsedOffset = parseInt(offset) || 0;
    const parsedLowStockThreshold = parseInt(lowStockThreshold) || 10;

    let data, count, hasMore;

    switch (type.toLowerCase()) {
      case 'list':
      case 'raw':
        // Get inventory data
        if (parsedIncludeMetadata) {
          data = await supabaseService.getInventoryWithMetadata({
            sku,
            search,
            limit: parsedLimit,
            offset: parsedOffset
          });
          count = data.length;
          hasMore = data.length === parsedLimit;
        } else {
          const result = await supabaseService.getInventory({
            sku,
            search,
            limit: parsedLimit,
            offset: parsedOffset,
            includeTotals: parsedIncludeTotals
          });
          data = result.data;
          count = result.totalCount;
          hasMore = result.hasMore;
        }
        break;

      case 'analytics':
      case 'summary':
        // Get inventory analytics
        data = await supabaseService.getInventoryAnalytics({
          lowStockThreshold: parsedLowStockThreshold,
          groupBy
        });
        count = data.totalSkus;
        hasMore = false;
        break;

      case 'update':
        // Update inventory (POST only)
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed. Use POST for updates.' });
        }

        if (!req.body.inventory || !Array.isArray(req.body.inventory)) {
          return res.status(400).json({
            error: 'Missing inventory data',
            expected: { inventory: [{ sku: 'ABC123', quantity: 10 }] }
          });
        }

        const updateResult = await supabaseService.updateInventory(req.body.inventory);
        data = { updated: updateResult.count };
        count = updateResult.count;
        hasMore = false;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['list', 'raw', 'analytics', 'summary', 'update']
        });
    }

    console.log(`✅ Inventory completed: ${count} records`);

    // Format response for Google Sheets compatibility
    let responseData = data;

    if (type === 'list' && Array.isArray(data) && !parsedIncludeMetadata) {
      // Convert to Google Sheets format (array of arrays)
      responseData = data.map(item => [
        item.sku,
        item.quantity,
        item.last_updated
      ]);
    }

    // Return success response
    return res.status(200).json({
      success: true,
      type,
      count,
      data: responseData,
      pagination: type !== 'analytics' && type !== 'update' ? {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore,
        totalCount: parsedIncludeTotals ? count : undefined
      } : undefined,
      filters: {
        sku: sku || 'all',
        search: search || null,
        groupBy: type === 'analytics' ? groupBy : undefined,
        lowStockThreshold: type === 'analytics' ? parsedLowStockThreshold : undefined,
        includeMetadata: parsedIncludeMetadata
      },
      timestamp: new Date().toISOString(),
      ...(type === 'list' && responseData.length > 0 && !parsedIncludeMetadata ? {
        headers: ['SKU', 'Quantity', 'Last Updated']
      } : {})
    });

  } catch (error) {
    console.error('💥 Inventory error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      filters: { sku: sku || 'all', search: search || null },
      timestamp: new Date().toISOString()
    });
  }
};