// api/metadata.js
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

  async getProductMetadata(options = {}) {
    const { sku, search, status, program, season, gender, limit = 10000, offset = 0, includeTotals = false } = options;

    let query = this.supabase
      .from('product_metadata')
      .select('*')
      .order('last_updated', { ascending: false });

    if (sku) {
      query = query.eq('sku', sku);
    }

    if (search) {
      query = query.or(`sku.ilike.%${search}%,product_title.ilike.%${search}%,variant_title.ilike.%${search}%`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (program) {
      query = query.eq('program', program);
    }

    if (season) {
      query = query.eq('season', season);
    }

    if (gender) {
      query = query.eq('gender', gender);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching product metadata:', error);
      throw error;
    }

    let totalCount = data?.length || 0;

    // Get total count if requested
    if (includeTotals) {
      let countQuery = this.supabase
        .from('product_metadata')
        .select('*', { count: 'exact', head: true });

      if (sku) countQuery = countQuery.eq('sku', sku);
      if (search) countQuery = countQuery.or(`sku.ilike.%${search}%,product_title.ilike.%${search}%,variant_title.ilike.%${search}%`);
      if (status) countQuery = countQuery.eq('status', status);
      if (program) countQuery = countQuery.eq('program', program);
      if (season) countQuery = countQuery.eq('season', season);
      if (gender) countQuery = countQuery.eq('gender', gender);

      const { count: exactCount } = await countQuery;
      totalCount = exactCount || 0;
    }

    return { data: data || [], totalCount, hasMore: (data?.length || 0) === limit };
  }

  async getMetadataAnalytics(options = {}) {
    const { groupBy = 'status' } = options;

    const { data, error } = await this.supabase
      .from('product_metadata')
      .select('*');

    if (error) {
      console.error('❌ Error fetching metadata analytics:', error);
      throw error;
    }

    return this.processMetadataAnalytics(data || [], groupBy);
  }

  processMetadataAnalytics(data, groupBy) {
    const grouped = {};
    const summary = {
      totalProducts: data.length,
      uniquePrograms: new Set(),
      uniqueSeasons: new Set(),
      uniqueGenders: new Set(),
      uniqueStatuses: new Set(),
      totalValue: 0,
      avgCost: 0
    };

    data.forEach(product => {
      const key = this.getMetadataGroupKey(product, groupBy);
      const cost = parseFloat(product.cost) || 0;

      // Update summary
      summary.uniquePrograms.add(product.program);
      summary.uniqueSeasons.add(product.season);
      summary.uniqueGenders.add(product.gender);
      summary.uniqueStatuses.add(product.status);
      summary.totalValue += cost;

      // Group data
      if (!grouped[key]) {
        grouped[key] = {
          groupKey: key,
          count: 0,
          totalCost: 0,
          avgCost: 0,
          products: []
        };
      }

      const group = grouped[key];
      group.count++;
      group.totalCost += cost;
      group.products.push({
        sku: product.sku,
        product_title: product.product_title,
        variant_title: product.variant_title,
        cost: cost
      });
    });

    // Calculate averages and convert to array
    const groupedArray = Object.values(grouped).map(group => ({
      ...group,
      avgCost: group.count > 0 ? (group.totalCost / group.count).toFixed(2) : 0,
      products: group.products.sort((a, b) => b.cost - a.cost).slice(0, 10) // Top 10 by cost
    })).sort((a, b) => b.totalCost - a.totalCost);

    // Convert summary sets to arrays/counts
    summary.uniquePrograms = Array.from(summary.uniquePrograms).filter(Boolean);
    summary.uniqueSeasons = Array.from(summary.uniqueSeasons).filter(Boolean);
    summary.uniqueGenders = Array.from(summary.uniqueGenders).filter(Boolean);
    summary.uniqueStatuses = Array.from(summary.uniqueStatuses).filter(Boolean);
    summary.avgCost = summary.totalProducts > 0 ? (summary.totalValue / summary.totalProducts).toFixed(2) : 0;

    return {
      summary,
      groupedData: groupedArray
    };
  }

  getMetadataGroupKey(product, groupBy) {
    switch (groupBy) {
      case 'status':
        return product.status || 'Unknown Status';
      case 'program':
        return product.program || 'Unknown Program';
      case 'produkt':
        return product.produkt || 'Unknown Product';
      case 'farve':
        return product.farve || 'Unknown Color';
      case 'season':
        return product.season || 'Unknown Season';
      case 'gender':
        return product.gender || 'Unknown Gender';
      case 'størrelse':
        return product.størrelse || 'Unknown Size';
      default:
        return product.status || 'Unknown Status';
    }
  }

  async updateProductMetadata(metadata) {
    if (!metadata || metadata.length === 0) return { count: 0 };

    console.log(`📋 Updating ${metadata.length} product metadata items...`);

    const dbMetadata = metadata.map(item => ({
      ...item,
      last_updated: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('product_metadata')
      .upsert(dbMetadata, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error updating product metadata:', error);
      throw error;
    }

    console.log(`✅ Successfully updated ${metadata.length} product metadata items`);
    return { count: metadata.length, data };
  }

  async enrichSkuData(skus, startDate, endDate) {
    // Get SKU data first (no join - manually enrich later)
    const { data, error } = await this.supabase
      .from('skus')
      .select('*')
      .gte('original_created_at', startDate.toISOString())
      .lte('original_created_at', endDate.toISOString())
      .in('sku', skus)
      .order('original_created_at', { ascending: false });

    if (error) {
      console.error('❌ Error enriching SKU data:', error);
      throw error;
    }

    // Get metadata separately for the SKUs
    const uniqueArtikelNummers = [...new Set(skus.map(sku => sku.split('\\')[0] || sku))];
    const metadataMap = {};

    if (uniqueArtikelNummers.length > 0) {
      // Fetch all metadata (since we can't filter by artikelnummer anymore)
      const { data: metadataData } = await this.supabase
        .from('product_metadata')
        .select('*');

      (metadataData || []).forEach(meta => {
        if (meta.sku) {
          const baseArtikelNummer = meta.sku.split('\\')[0] || meta.sku;
          if (uniqueArtikelNummers.includes(baseArtikelNummer)) {
            if (!metadataMap[baseArtikelNummer]) {
              metadataMap[baseArtikelNummer] = meta;
            }
          }
        }
      });
    }

    // Manually enrich each SKU record
    return (data || []).map(item => ({
      ...item,
      product_metadata: metadataMap[item.sku?.split('\\')[0]] || null
    }));
  }

  async getInventoryData(options = {}) {
    const { limit = 10000, offset = 0 } = options;

    const { data, error } = await this.supabase
      .from('inventory')
      .select('*')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('❌ Error fetching inventory data:', error);
      throw error;
    }

    return { data: data || [], totalCount: data?.length || 0 };
  }

  async getStyleAnalytics(startDate, endDate, options = {}) {
    const { groupBy = 'farve', shop = null } = options;

    // Special handling for stamvarenummer grouping
    if (groupBy === 'stamvarenummer') {
      return this.getStamvarenummerAnalytics(startDate, endDate, options);
    }

    // Ensure we have the full day range - fix same-day queries
    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    console.log(`📅 Style Analytics query: ${adjustedStartDate.toISOString()} to ${adjustedEndDate.toISOString()}`);

    // STEP 1: Fetch sales data (SKUs created in period) - similar to Dashboard API
    let salesData = [];
    let hasMore = true;
    let currentOffset = 0;
    const batchSize = 1000;

    while (hasMore) {
      let batchQuery = this.supabase
        .from('skus')
        .select('sku, shop, order_id, quantity, refunded_qty, cancelled_qty, price_dkk, created_at_original, product_title, variant_title, refund_date, discount_per_unit_dkk')
        .gte('created_at_original', adjustedStartDate.toISOString())
        .lte('created_at_original', adjustedEndDate.toISOString())
        .order('created_at_original', { ascending: false })
        .range(currentOffset, currentOffset + batchSize - 1);

      if (shop) {
        batchQuery = batchQuery.eq('shop', shop);
      }

      const { data: batchData, error: batchError } = await batchQuery;

      if (batchError) {
        console.error('❌ Error fetching sales batch:', batchError);
        throw batchError;
      }

      if (batchData && batchData.length > 0) {
        salesData = salesData.concat(batchData);
        currentOffset += batchData.length;

        console.log(`  ✅ Sales batch: ${batchData.length} records, total: ${salesData.length}`);

        if (batchData.length < batchSize) {
          hasMore = false;
          console.log(`  ✅ Reached end of sales data (got ${batchData.length} < ${batchSize})`);
        }
      } else {
        hasMore = false;
        console.log(`  ✅ No more sales data available`);
      }
    }


    // STEP 2: Fetch refund data (SKUs with refund_date in period) - matching Dashboard API logic
    let refundQuery = this.supabase
      .from('skus')
      .select('sku, shop, order_id, quantity, refunded_qty, cancelled_qty, price_dkk, created_at, product_title, variant_title, refund_date, discount_per_unit_dkk')
      .not('refund_date', 'is', null)
      .gte('refund_date', adjustedStartDate.toISOString())
      .lte('refund_date', adjustedEndDate.toISOString())
      .order('refund_date', { ascending: false });

    if (shop) {
      refundQuery = refundQuery.eq('shop', shop);
    }

    const { data: refundData, error: refundError } = await refundQuery;

    if (refundError) {
      console.error('❌ Error fetching refund data:', refundError);
      throw refundError;
    }

    console.log(`📦 Refund data fetched: ${refundData?.length || 0} rows`);
    const totalRefundedQty = (refundData || []).reduce((sum, item) => sum + (item.refunded_qty || 0), 0);
    console.log(`📦 Total refunded_qty from refund query: ${totalRefundedQty}`);


    // STEP 3: Combine sales and refund data correctly
    // Sales data: Include quantity as sold, but refunded_qty should be 0 unless refund happened in same period
    // Refund data: Only include refunded_qty, quantity should not be counted as additional sales
    const combinedData = [];

    // Add sales data (mark refunded_qty as 0 unless refund_date is also in period)
    salesData.forEach(item => {
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= adjustedStartDate &&
        new Date(item.refund_date) <= adjustedEndDate;

      combinedData.push({
        ...item,
        // For sales: include the quantity sold, but only count refunded_qty if refund happened in period
        quantity: item.quantity || 0,
        refunded_qty: hasRefundInPeriod ? (item.refunded_qty || 0) : 0,
        source: 'sales'
      });
    });

    // Add refund data (don't double-count quantities, only add refunds that aren't already counted)
    refundData.forEach(item => {
      // Check if this exact item (shop + order_id + sku) is already in sales data
      const alreadyInSales = salesData.some(salesItem =>
        salesItem.shop === item.shop &&
        salesItem.order_id === item.order_id &&
        salesItem.sku === item.sku
      );

      if (!alreadyInSales) {
        // This is a refund for an order created outside the period
        combinedData.push({
          ...item,
          quantity: 0, // Don't count as new sales
          refunded_qty: item.refunded_qty || 0,
          source: 'refund_only'
        });
      }
    });

    const data = combinedData;

    // Extract unique artikelnummer from SKUs (part before backslash) to match metadata
    const uniqueArtikelNummers = [...new Set((data || []).map(item => {
      const sku = item.sku || '';
      return sku.split('\\')[0] || sku; // Extract artikelnummer before backslash
    }).filter(Boolean))];


    // Fetch ALL metadata to show all products, even those without sales
    const metadataMap = {};
    const artikelnummerWithSales = new Set(uniqueArtikelNummers); // Set of artikelnummer with sales
    const allArtikelNummers = new Set(); // Will contain ALL artikelnummer from metadata

    try {
      // Fetch ALL metadata in chunks to overcome Supabase's 1000 row limit
      let offset = 0;
      const chunkSize = 1000;
      let hasMore = true;
      let totalFetched = 0;

      console.log(`📋 Fetching all product metadata in chunks of ${chunkSize}...`);

      while (hasMore) {
        const { data: chunk, error: metadataError } = await this.supabase
          .from('product_metadata')
          .select('sku, program, season, gender, status, cost, varemodtaget, tags, price, compare_at_price, størrelse, product_title, variant_title, stamvarenummer')
          // Include both ACTIVE and ARCHIVED products to show historical data
          .order('sku', { ascending: true })
          .range(offset, offset + chunkSize - 1);

        if (metadataError) {
          console.warn(`⚠️ Error fetching metadata chunk at offset ${offset}:`, metadataError.message);
          hasMore = false;
        } else if (!chunk || chunk.length === 0) {
          hasMore = false;
        } else {
          totalFetched += chunk.length;

          // Build metadata map from this chunk
          chunk.forEach(meta => {
            if (meta.sku) {
              // Extract the base artikelnummer from the SKU (part before backslash)
              const baseArtikelNummer = meta.sku.split('\\')[0] || meta.sku;

              if (!metadataMap[baseArtikelNummer]) {
                // Create new entry with first metadata values
                metadataMap[baseArtikelNummer] = {
                  ...meta,
                  varemodtaget: parseInt(meta.varemodtaget) || 0
                };

                // Add to uniqueArtikelNummers even if no sales
                if (!allArtikelNummers.has(baseArtikelNummer)) {
                  uniqueArtikelNummers.push(baseArtikelNummer);
                  allArtikelNummers.add(baseArtikelNummer);
                }
              } else {
                // Sum varemodtaget from all SKUs for same artikelnummer
                metadataMap[baseArtikelNummer].varemodtaget += parseInt(meta.varemodtaget) || 0;

                // Update price to use the highest of all variants
                const currentMax = Math.max(
                  parseFloat(metadataMap[baseArtikelNummer].price) || 0,
                  parseFloat(metadataMap[baseArtikelNummer].compare_at_price) || 0
                );
                const newMax = Math.max(
                  parseFloat(meta.price) || 0,
                  parseFloat(meta.compare_at_price) || 0
                );
                if (newMax > currentMax) {
                  metadataMap[baseArtikelNummer].price = meta.price;
                  metadataMap[baseArtikelNummer].compare_at_price = meta.compare_at_price;
                }
              }
            }
          });

          // Continue if we got a full chunk
          if (chunk.length < chunkSize) {
            hasMore = false;
          } else {
            offset += chunkSize;
          }
        }
      }

    } catch (metaError) {
      console.warn('⚠️ Error fetching metadata, using parsed product titles:', metaError.message);
    }

    // Create a map of sales data by artikelnummer for easy lookup
    const salesByArtikelnummer = {};
    (data || []).forEach(item => {
      const sku = item.sku || '';
      const artikelnummer = sku.split('\\')[0] || sku;
      if (!salesByArtikelnummer[artikelnummer]) {
        salesByArtikelnummer[artikelnummer] = [];
      }
      salesByArtikelnummer[artikelnummer].push(item);
    });

    return await this.processBasicStyleAnalytics(salesByArtikelnummer, groupBy, metadataMap, allArtikelNummers);
  }

  async getStamvarenummerAnalytics(startDate, endDate, options = {}) {
    const { shop = null } = options;

    // Ensure we have the full day range
    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    console.log(`📅 Stamvarenummer Analytics query: ${adjustedStartDate.toISOString()} to ${adjustedEndDate.toISOString()}`);

    // STEP 1: Fetch sales data (same as getStyleAnalytics)
    let salesData = [];
    let hasMore = true;
    let currentOffset = 0;
    const batchSize = 1000;

    while (hasMore) {
      let batchQuery = this.supabase
        .from('skus')
        .select('sku, shop, quantity, refunded_qty, cancelled_qty, price_dkk, created_at_original, product_title, variant_title, refund_date, discount_per_unit_dkk')
        .gte('created_at_original', adjustedStartDate.toISOString())
        .lte('created_at_original', adjustedEndDate.toISOString())
        .order('created_at_original', { ascending: false })
        .range(currentOffset, currentOffset + batchSize - 1);

      if (shop) {
        batchQuery = batchQuery.eq('shop', shop);
      }

      const { data: batchData, error: batchError } = await batchQuery;

      if (batchError) {
        console.error('❌ Error fetching sales batch:', batchError);
        throw batchError;
      }

      if (batchData && batchData.length > 0) {
        salesData = salesData.concat(batchData);
        currentOffset += batchData.length;
        console.log(`  ✅ Sales batch: ${batchData.length} records, total: ${salesData.length}`);

        if (batchData.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    // STEP 2: Fetch refund data
    let refundQuery = this.supabase
      .from('skus')
      .select('sku, shop, quantity, refunded_qty, cancelled_qty, price_dkk, created_at, product_title, variant_title, refund_date, discount_per_unit_dkk')
      .not('refund_date', 'is', null)
      .gte('refund_date', adjustedStartDate.toISOString())
      .lte('refund_date', adjustedEndDate.toISOString())
      .order('refund_date', { ascending: false });

    if (shop) {
      refundQuery = refundQuery.eq('shop', shop);
    }

    const { data: refundData, error: refundError } = await refundQuery;

    if (refundError) {
      console.error('❌ Error fetching refund data:', refundError);
      throw refundError;
    }

    // STEP 3: Combine sales and refund data
    const combinedData = [];

    salesData.forEach(item => {
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= adjustedStartDate &&
        new Date(item.refund_date) <= adjustedEndDate;

      combinedData.push({
        ...item,
        quantity: item.quantity || 0,
        refunded_qty: hasRefundInPeriod ? (item.refunded_qty || 0) : 0,
        source: 'sales'
      });
    });

    refundData.forEach(item => {
      const alreadyInSales = salesData.some(salesItem =>
        salesItem.shop === item.shop &&
        salesItem.order_id === item.order_id &&
        salesItem.sku === item.sku
      );

      if (!alreadyInSales) {
        combinedData.push({
          ...item,
          quantity: 0,
          refunded_qty: item.refunded_qty || 0,
          source: 'refund_only'
        });
      }
    });

    const data = combinedData;

    // Extract unique artikelnummer from SKUs
    const uniqueArtikelNummers = [...new Set((data || []).map(item => {
      const sku = item.sku || '';
      return sku.split('\\')[0] || sku;
    }).filter(Boolean))];

    // Fetch ALL metadata
    const metadataMap = {};
    const allArtikelNummers = new Set();
    let offset = 0;
    const chunkSize = 1000;
    hasMore = true;

    console.log(`📋 Fetching all product metadata in chunks of ${chunkSize}...`);

    while (hasMore) {
      const { data: chunk, error: metadataError } = await this.supabase
        .from('product_metadata')
        .select('sku, stamvarenummer, program, season, gender, status, cost, varemodtaget, tags, price, compare_at_price, størrelse, product_title, variant_title')
        .order('sku', { ascending: true })
        .range(offset, offset + chunkSize - 1);

      if (metadataError) {
        console.warn(`⚠️ Error fetching metadata chunk at offset ${offset}:`, metadataError.message);
        hasMore = false;
      } else if (!chunk || chunk.length === 0) {
        hasMore = false;
      } else {
        chunk.forEach(meta => {
          if (!meta.sku) return;

          const baseArtikelNummer = meta.sku.split('\\')[0] || meta.sku;
          allArtikelNummers.add(baseArtikelNummer);

          // Store metadata for each artikelnummer
          if (!metadataMap[baseArtikelNummer]) {
            metadataMap[baseArtikelNummer] = {
              artikelnummer: baseArtikelNummer,
              stamvarenummer: meta.stamvarenummer || '',
              program: meta.program || '',
              season: meta.season || '',
              gender: meta.gender || '',
              status: meta.status || 'UNKNOWN',
              cost: parseFloat(meta.cost) || 0,
              varemodtaget: parseInt(meta.varemodtaget) || 0,
              tags: meta.tags || '',
              price: parseFloat(meta.price) || 0,
              compare_at_price: parseFloat(meta.compare_at_price) || 0,
              product_title: meta.product_title || '',
              variant_title: meta.variant_title || ''
            };
          } else {
            // Aggregate varemodtaget across all SKUs for this artikelnummer
            metadataMap[baseArtikelNummer].varemodtaget += parseInt(meta.varemodtaget) || 0;

            // Keep highest price
            if (meta.price && parseFloat(meta.price) > metadataMap[baseArtikelNummer].price) {
              metadataMap[baseArtikelNummer].price = meta.price;
            }
            if (meta.compare_at_price && parseFloat(meta.compare_at_price) > metadataMap[baseArtikelNummer].compare_at_price) {
              metadataMap[baseArtikelNummer].compare_at_price = meta.compare_at_price;
            }
          }
        });

        if (chunk.length < chunkSize) {
          hasMore = false;
        } else {
          offset += chunkSize;
        }
      }
    }

    // Create a map of sales data by artikelnummer
    const salesByArtikelnummer = {};
    (data || []).forEach(item => {
      const sku = item.sku || '';
      const artikelnummer = sku.split('\\')[0] || sku;
      if (!salesByArtikelnummer[artikelnummer]) {
        salesByArtikelnummer[artikelnummer] = [];
      }
      salesByArtikelnummer[artikelnummer].push(item);
    });

    return await this.processStamvarenummerAnalytics(salesByArtikelnummer, metadataMap, allArtikelNummers);
  }

  async getSkuAnalytics(startDate, endDate, options = {}) {
    const { shop = null } = options;

    // Ensure we have the full day range - fix same-day queries
    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    console.log(`📅 SKU Analytics query: ${adjustedStartDate.toISOString()} to ${adjustedEndDate.toISOString()}`);

    // STEP 1: Fetch sales data (SKUs created in period)
    let salesQuery = this.supabase
      .from('skus')
      .select('*')
      .gte('created_at_original', adjustedStartDate.toISOString())
      .lte('created_at_original', adjustedEndDate.toISOString());

    if (shop) {
      salesQuery = salesQuery.eq('shop', shop);
    }

    const { data: salesData, error: salesError } = await salesQuery;

    if (salesError) {
      console.error('❌ Error fetching SKU sales data:', salesError);
      throw salesError;
    }


    // STEP 2: Fetch refund data (SKUs with refund_date in period)
    let refundQuery = this.supabase
      .from('skus')
      .select('*')
      .not('refund_date', 'is', null)
      .gte('refund_date', adjustedStartDate.toISOString())
      .lte('refund_date', adjustedEndDate.toISOString());

    if (shop) {
      refundQuery = refundQuery.eq('shop', shop);
    }

    const { data: refundData, error: refundError } = await refundQuery;

    if (refundError) {
      console.error('❌ Error fetching SKU refund data:', refundError);
      throw refundError;
    }


    // STEP 3: Combine sales and refund data correctly for SKU-level analysis
    const combinedData = [];

    // Add sales data (mark refunded_qty as 0 unless refund_date is also in period)
    (salesData || []).forEach(item => {
      const hasRefundInPeriod = item.refund_date &&
        new Date(item.refund_date) >= adjustedStartDate &&
        new Date(item.refund_date) <= adjustedEndDate;

      combinedData.push({
        ...item,
        quantity: item.quantity || 0,
        refunded_qty: hasRefundInPeriod ? (item.refunded_qty || 0) : 0,
        source: 'sales'
      });
    });

    // Add refund data (don't double-count quantities, only add refunds that aren't already counted)
    (refundData || []).forEach(item => {
      // Check if this exact item (shop + order_id + sku) is already in sales data
      const alreadyInSales = (salesData || []).some(salesItem =>
        salesItem.shop === item.shop &&
        salesItem.order_id === item.order_id &&
        salesItem.sku === item.sku
      );

      if (!alreadyInSales) {
        // This is a refund for an order created outside the period
        combinedData.push({
          ...item,
          quantity: 0, // Don't count as new sales
          refunded_qty: item.refunded_qty || 0,
          source: 'refund_only'
        });
      }
    });

    const data = combinedData;

    return this.processSkuAnalytics(data);
  }

  async processBasicStyleAnalytics(salesByArtikelnummer, groupBy, metadataMap = {}, allArtikelNummers = new Set()) {
    // Group by style (artikelnummer) extracted from SKU
    // Aggregate all sizes and shops for each style
    // This replicates the original STYLE_COLOR_Analytics.gs logic

    const grouped = {};

    // IMPORTANT: First, create entries for ALL products from metadata (even those without sales)
    // This ensures Color_Analytics shows ALL products, not just those with sales
    if (metadataMap && Object.keys(metadataMap).length > 0) {
      Object.keys(metadataMap).forEach(artikelnummer => {
        const meta = metadataMap[artikelnummer];

        // ALWAYS parse product title since produkt/farve fields in database are empty
        // Use metadata title, not SKU title to ensure Danish language
        let parsedTitle = { program: '', produkt: '', farve: '' };
        const titleToUse = meta.product_title || meta.variant_title || '';
        if (titleToUse) {
          parsedTitle = this.parseProductTitle(titleToUse);
        }

        // Parse gender field to clean up JSON array strings
        let cleanGender = '';
        if (meta.gender) {
          try {
            // Try to parse if it's a JSON array string like '["Girl"]' or '["Boy","Girl"]'
            const parsed = JSON.parse(meta.gender);
            if (Array.isArray(parsed)) {
              cleanGender = parsed.join(', ');
            } else {
              cleanGender = meta.gender;
            }
          } catch (e) {
            // If parsing fails, use as-is but clean up extra quotes
            cleanGender = meta.gender.replace(/["\[\]]/g, '');
          }
        }

        grouped[artikelnummer] = {
          // Use parsed values for produkt/farve (database fields are empty)
          // Use metadata for season/gender/program
          program: meta.program || parsedTitle.program || '',
          produkt: parsedTitle.produkt || '',  // Always from parsed title
          farve: parsedTitle.farve || '',      // Always from parsed title
          artikelnummer: artikelnummer,
          season: meta.season || '',           // From metadata
          gender: cleanGender,                 // Cleaned gender (from JSON array)
          variantTitle: meta.variant_title || '',  // Variant title for størrelse
          solgt: 0,
          retur: 0,
          cancelled: 0,
          omsætning: 0,
          lager: 0,
          varemodtaget: parseInt(meta.varemodtaget) || 0,
          kostpris: parseFloat(meta.cost) || 0,
          status: meta.status || 'UNKNOWN',
          tags: meta.tags || '',
          maxPris: Math.max(
            parseFloat(meta.price) || 0,
            parseFloat(meta.compare_at_price) || 0
          ),
          shops: new Set(),
          skus: new Set()
        };
      });
    }

    // Second pass: aggregate sales data for artikelnummer that have sales
    // Now loop through salesByArtikelnummer (which only contains artikelnummer with sales)
    Object.keys(salesByArtikelnummer).forEach(artikelnummer => {
      const salesItems = salesByArtikelnummer[artikelnummer] || [];

      // Process each sale for this artikelnummer
      salesItems.forEach(item => {
        let group = grouped[artikelnummer];

        // If no metadata exists for this artikelnummer, create a minimal entry
        if (!group) {
          console.warn(`⚠️ No metadata for artikelnummer ${artikelnummer}, creating minimal entry`);

          // Parse product title to extract program/produkt/farve
          let parsedTitle = { program: '', produkt: '', farve: '' };
          const titleToUse = item.product_title || item.variant_title || '';
          if (titleToUse) {
            parsedTitle = this.parseProductTitle(titleToUse);
          }

          grouped[artikelnummer] = {
            program: parsedTitle.program || '',
            produkt: parsedTitle.produkt || '',
            farve: parsedTitle.farve || '',
            artikelnummer: artikelnummer,
            season: '',
            gender: '',  // Clean gender (empty for no metadata)
            variantTitle: '',  // Empty variant title for no metadata
            solgt: 0,
            retur: 0,
            cancelled: 0,
            omsætning: 0,
            lager: 0,
            varemodtaget: 0,
            kostpris: 0,
            status: 'NO_METADATA',
            tags: '',
            maxPris: 0,
            shops: new Set(),
            skus: new Set()
          };
          group = grouped[artikelnummer];
        }

        const quantity = item.quantity || 0;
        const refunded = item.refunded_qty || 0;
        const cancelled = item.cancelled_qty || 0;

        // Calculate actual price paid per unit (v2)
        // price_dkk is the discounted unit price (from discountedUnitPriceSet) - includes line-level discounts
        // discount_per_unit_dkk is the order-level discount allocation per unit
        // Final price = price_dkk - discount_per_unit_dkk
        const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
        const bruttoQty = quantity - cancelled; // Brutto = quantity minus cancelled (actual sold items)
        const revenue = unitPriceAfterDiscount * bruttoQty;

        group.solgt += bruttoQty;  // Brutto quantity (excludes cancelled)
        group.retur += refunded;
        group.cancelled += cancelled;
        group.omsætning += revenue;
        group.shops.add(item.shop);
        group.skus.add(item.sku);

        // DON'T update metadata from item - it should come from metadataMap ONLY
        // The SKU table doesn't have season/gender - those only exist in metadata
        // vejlPris (maxPris) should ONLY come from metadata, not from actual sale prices
        // Only update cost and varemodtaget if they're not set from metadata
        if (item.cost && group.kostpris === 0) {
          group.kostpris = parseFloat(item.cost) || 0;
        }
        if (item.varemodtaget && group.varemodtaget === 0) {
          group.varemodtaget = parseInt(item.varemodtaget) || 0;
        }

        // Don't update maxPris from sales data - vejlPris should only come from metadata
        // (item.price_dkk is the actual discounted sale price, not the recommended retail price)
      });
    });

    console.log(`📦 Found ${Object.keys(grouped).length} unique styles, fetching inventory...`);

    // Second pass: get inventory data for each style
    try {
      // Fetch ALL inventory data in batches (Supabase has a row limit per query)
      const inventoryByStyle = {};
      let offset = 0;
      const batchSize = 1000;
      let hasMoreInventory = true;
      let totalInventoryRecords = 0;

      console.log(`📦 Fetching all inventory data in batches of ${batchSize}...`);

      while (hasMoreInventory) {
        const { data, error } = await this.supabase
          .from('inventory')
          .select('sku, quantity')
          .range(offset, offset + batchSize - 1);

        if (error) {
          console.error(`❌ Error fetching inventory batch at offset ${offset}:`, error);
          break;
        }

        if (!data || data.length === 0) {
          hasMoreInventory = false;
          break;
        }

        totalInventoryRecords += data.length;

        // Aggregate this batch by artikelnummer
        data.forEach(invItem => {
          const sku = invItem.sku || '';
          const artikelnummer = sku.split('\\')[0] || sku;

          if (!inventoryByStyle[artikelnummer]) {
            inventoryByStyle[artikelnummer] = 0;
          }
          inventoryByStyle[artikelnummer] += parseInt(invItem.quantity) || 0;
        });

        console.log(`  ✅ Inventory batch: ${data.length} records, total: ${totalInventoryRecords}`);

        if (data.length < batchSize) {
          hasMoreInventory = false;
        } else {
          offset += batchSize;
        }
      }

      console.log(`📦 Retrieved ${totalInventoryRecords} total inventory records`);
      console.log(`📦 Inventory aggregated for ${Object.keys(inventoryByStyle).length} artikelnummer`);

      if (Object.keys(inventoryByStyle).length === 0) {
        console.warn('⚠️ No inventory data found in inventory table - run inventory sync first');
      }

      // Update grouped data with inventory
      Object.keys(grouped).forEach(artikelnummer => {
        grouped[artikelnummer].lager = inventoryByStyle[artikelnummer] || 0;
      });

    } catch (error) {
      console.error('⚠️ Error fetching inventory data:', error.message);
      // Continue without inventory data
    }

    // Third pass: calculate derived metrics (following original STYLE_COLOR logic)
    const results = Object.values(grouped).map(group => {
      // Convert Sets to counts for final output
      const shopCount = group.shops.size;
      const skuCount = group.skus.size;

      // Beregnet købt = lager + solgt - retur (solgt er allerede netto efter cancelled)
      const beregnetKøbt = group.lager + group.solgt - group.retur;

      // If no varemodtaget data, estimate as beregnetKøbt (simplified assumption)
      if (group.varemodtaget === 0) {
        group.varemodtaget = beregnetKøbt;
      }

      // Difference = købt - varemodtaget
      const difference = beregnetKøbt - group.varemodtaget;

      // Net sold (actual units sold after returns)
      const nettoSolgt = group.solgt - group.retur;

      // Sold % of bought = netto_solgt / købt * 100
      const solgtPct = beregnetKøbt > 0 ? Math.round((nettoSolgt / beregnetKøbt) * 100 * 10) / 10 : 0;

      // Return % of sold = retur / solgt * 100
      const returPct = group.solgt > 0 ? Math.round((group.retur / group.solgt) * 100 * 10) / 10 : 0;

      // DB (Dækningsgrad) = (omsætning - (netto_solgt * kostpris)) / omsætning * 100
      const db = group.omsætning > 0 && nettoSolgt > 0 && group.kostpris > 0 ?
        Math.round(((group.omsætning - (nettoSolgt * group.kostpris)) / group.omsætning) * 100 * 10) / 10 : 0;

      // Overløber detection from tags
      const isOverløber = group.tags.toLowerCase().includes('overløber') ? 'Overløber' : '';

      return {
        program: group.program,
        produkt: group.produkt,
        farve: group.farve,
        artikelnummer: group.artikelnummer,
        season: group.season,
        gender: group.gender,
        størrelse: groupBy === 'sku' ? (group.variantTitle || '') : '',  // variant_title when grouping by SKU
        beregnetKøbt: Math.round(beregnetKøbt),
        solgt: group.solgt,
        retur: group.retur,
        cancelled: group.cancelled,
        lager: group.lager,
        varemodtaget: group.varemodtaget,
        difference: Math.round(difference),
        solgtPct: solgtPct,
        returPct: returPct,
        kostpris: Math.round(group.kostpris * 100) / 100,
        db: db,
        omsætning: Math.round(group.omsætning * 100) / 100,
        status: group.status,
        tags: isOverløber,
        vejlPris: Math.round(group.maxPris * 100) / 100,
        shopCount: shopCount,
        skuCount: skuCount
      };
    }).sort((a, b) => b.omsætning - a.omsætning);

    console.log(`✅ Processed ${results.length} styles with inventory integration`);
    return results;
  }

  async processStamvarenummerAnalytics(salesByArtikelnummer, metadataMap = {}, allArtikelNummers = new Set()) {
    // Group by stamvarenummer, aggregating colors within each master style number
    // This replicates the original STYLE_NUMBER_Analytics.gs logic

    const grouped = {};

    // Helper function to derive grouping key (stamvarenummer)
    const deriveStamvarenummer = (artikelnummer) => {
      const meta = metadataMap[artikelnummer];
      if (!meta) return artikelnummer;

      // Use stamvarenummer if available
      if (meta.stamvarenummer && meta.stamvarenummer.trim()) {
        return meta.stamvarenummer.trim();
      }

      // Fallback: Extract base product name from product_title
      // Example: "Boho tunika - Little - Dark Purple" -> "Boho tunika - Little"
      const productTitle = meta.product_title || '';
      if (productTitle) {
        const parts = productTitle.split(' - ');
        if (parts.length >= 2) {
          // Find second occurrence of " - "
          const secondDashIndex = productTitle.indexOf(' - ', productTitle.indexOf(' - ') + 3);
          if (secondDashIndex > 0) {
            return productTitle.substring(0, secondDashIndex);
          }
        }
      }

      // Final fallback: use artikelnummer
      return artikelnummer;
    };

    // FIRST PASS: Initialize entries for ALL products from metadata
    if (metadataMap && Object.keys(metadataMap).length > 0) {
      Object.keys(metadataMap).forEach(artikelnummer => {
        const meta = metadataMap[artikelnummer];
        const stamvarenummer = deriveStamvarenummer(artikelnummer);

        // Parse product title for produkt field
        let parsedTitle = { program: '', produkt: '', farve: '' };
        const titleToUse = meta.product_title || meta.variant_title || '';
        if (titleToUse) {
          parsedTitle = this.parseProductTitle(titleToUse);
        }

        if (!grouped[stamvarenummer]) {
          grouped[stamvarenummer] = {
            program: meta.program || parsedTitle.program || '',
            produkt: parsedTitle.produkt || '',
            stamvarenummer: stamvarenummer,
            season: meta.season || '',
            gender: meta.gender || '',
            solgt: 0,
            retur: 0,
            cancelled: 0,
            omsætning: 0,
            lager: 0,
            varemodtaget: parseInt(meta.varemodtaget) || 0,
            kostpris: parseFloat(meta.cost) || 0,
            status: meta.status || 'UNKNOWN',
            tags: meta.tags || '',
            maxPris: Math.max(
              parseFloat(meta.price) || 0,
              parseFloat(meta.compare_at_price) || 0
            ),
            shops: new Set(),
            skus: new Set(),
            artikelnummerCount: 0
          };
        } else {
          // Aggregate varemodtaget across different artikelnummer in same stamvarenummer
          grouped[stamvarenummer].varemodtaget += parseInt(meta.varemodtaget) || 0;

          // Keep highest price
          grouped[stamvarenummer].maxPris = Math.max(
            grouped[stamvarenummer].maxPris,
            parseFloat(meta.price) || 0,
            parseFloat(meta.compare_at_price) || 0
          );
        }

        grouped[stamvarenummer].artikelnummerCount++;
      });
    }

    // SECOND PASS: Aggregate sales data by stamvarenummer
    Object.keys(salesByArtikelnummer).forEach(artikelnummer => {
      const salesItems = salesByArtikelnummer[artikelnummer] || [];
      const stamvarenummer = deriveStamvarenummer(artikelnummer);

      const group = grouped[stamvarenummer];
      if (!group) {
        console.warn(`⚠️ No metadata for stamvarenummer ${stamvarenummer} with sales`);
        return;
      }

      salesItems.forEach(item => {
        const quantity = item.quantity || 0;
        const refunded = item.refunded_qty || 0;
        const cancelled = item.cancelled_qty || 0;

        // Calculate actual price paid per unit (v2)
        // price_dkk is the discounted unit price (from discountedUnitPriceSet) - includes line-level discounts
        // discount_per_unit_dkk is the order-level discount allocation per unit
        // Final price = price_dkk - discount_per_unit_dkk
        const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
        const bruttoQty = quantity - cancelled; // Brutto = quantity minus cancelled (actual sold items)
        const revenue = unitPriceAfterDiscount * bruttoQty;

        group.solgt += bruttoQty;  // Brutto quantity (excludes cancelled)
        group.retur += refunded;
        group.cancelled += cancelled;
        group.omsætning += revenue;
        group.shops.add(item.shop);
        group.skus.add(item.sku);
      });
    });

    console.log(`📦 Found ${Object.keys(grouped).length} unique stamvarenummer, fetching inventory...`);

    // THIRD PASS: Add inventory data from separate inventory table
    const stamvarenummerWithSales = Object.keys(grouped);

    // Get all SKUs from grouped data
    const allSkus = new Set();
    Object.values(grouped).forEach(group => {
      group.skus.forEach(sku => allSkus.add(sku));
    });

    // Add SKUs from metadataMap even if they don't have sales
    Object.keys(metadataMap).forEach(artikelnummer => {
      // Get all sizes for this artikelnummer
      const sizeVariants = Object.keys(metadataMap).filter(a => a.startsWith(artikelnummer + '\\'));
      sizeVariants.forEach(variant => allSkus.add(variant));
    });

    if (allSkus.size > 0) {
      const skuArray = Array.from(allSkus);
      console.log(`🔍 Fetching inventory for ${skuArray.length} SKUs...`);

      // Fetch inventory in batches
      const batchSize = 1000;
      const inventoryMap = {};

      for (let i = 0; i < skuArray.length; i += batchSize) {
        const batch = skuArray.slice(i, i + batchSize);
        const { data: inventoryData, error: inventoryError } = await this.supabase
          .from('inventory')
          .select('sku, quantity')
          .in('sku', batch);

        if (!inventoryError && inventoryData) {
          inventoryData.forEach(inv => {
            inventoryMap[inv.sku] = inv.quantity || 0;
          });
        }
      }

      // Aggregate inventory to stamvarenummer level
      Object.keys(grouped).forEach(stamvarenummer => {
        const group = grouped[stamvarenummer];
        let totalInventory = 0;

        // Sum inventory for all SKUs in this stamvarenummer
        group.skus.forEach(sku => {
          totalInventory += inventoryMap[sku] || 0;
        });

        // Also add inventory for SKUs without sales but in same stamvarenummer
        Object.keys(metadataMap).forEach(artikelnummer => {
          if (deriveStamvarenummer(artikelnummer) === stamvarenummer) {
            // Get all size variants
            const sizeVariants = Object.keys(metadataMap).filter(a => a.startsWith(artikelnummer + '\\'));
            sizeVariants.forEach(variant => {
              if (!group.skus.has(variant)) {
                totalInventory += inventoryMap[variant] || 0;
              }
            });
          }
        });

        group.lager = totalInventory;
      });
    }

    // FOURTH PASS: Calculate metrics and format results
    const results = Object.keys(grouped).map(stamvarenummer => {
      const group = grouped[stamvarenummer];

      const købt = group.lager + group.solgt - group.retur;
      const solgtPct = købt > 0 ? (group.solgt / købt) * 100 : 0;
      const returPct = group.solgt > 0 ? (group.retur / group.solgt) * 100 : 0;
      const difference = købt - group.varemodtaget;
      const db = group.omsætning - (group.kostpris * (group.solgt - group.retur));

      const shopCount = group.shops.size;
      const skuCount = group.skus.size;

      return {
        program: group.program,
        produkt: group.produkt,
        stamvarenummer: stamvarenummer,
        season: group.season,
        gender: group.gender,
        beregnetKøbt: købt,
        solgt: group.solgt,
        retur: group.retur,
        lager: group.lager,
        varemodtaget: group.varemodtaget,
        difference: difference,
        solgtPct: Math.round(solgtPct * 100) / 100,
        returPct: Math.round(returPct * 100) / 100,
        kostpris: Math.round(group.kostpris * 100) / 100,
        db: Math.round(db * 100) / 100,
        omsætning: Math.round(group.omsætning * 100) / 100,
        status: group.status,
        vejlPris: Math.round(group.maxPris * 100) / 100,
        artikelnummerCount: group.artikelnummerCount,
        shopCount: shopCount,
        skuCount: skuCount
      };
    }).sort((a, b) => a.stamvarenummer.localeCompare(b.stamvarenummer));

    console.log(`✅ Processed ${results.length} stamvarenummer with inventory integration`);
    return results;
  }

  parseProductTitle(title) {
    // Parse titles like "Skibukser - Tween - Chocolate | 100515 Calgary"
    // Return program, produkt, farve extracted from title

    if (!title) {
      return { program: 'Unknown', produkt: 'Unknown', farve: 'Unknown' };
    }

    // Split by | to separate product description from program
    const parts = title.split('|');
    let program = 'Unknown';
    let productPart = title;

    if (parts.length > 1) {
      // Extract program from right side (e.g., "100515 Calgary" -> "Calgary")
      const rightPart = parts[1].trim();
      const programMatch = rightPart.match(/\d+\s+(.+)/);
      program = programMatch ? programMatch[1].trim() : rightPart;
      productPart = parts[0].trim();
    }

    // Parse product part (e.g., "Skibukser - Tween - Chocolate")
    // IMPORTANT: Split on " - " with spaces, not just "-" to avoid breaking hyphenated product names
    const productParts = productPart.split(' - ').map(p => p.trim());

    let produkt = 'Unknown';
    let farve = 'Unknown';

    if (productParts.length >= 1) {
      produkt = productParts[0];
    }
    if (productParts.length >= 3) {
      farve = productParts[2];
    } else if (productParts.length >= 2) {
      farve = productParts[1];
    }

    return { program, produkt, farve };
  }

  processSkuAnalytics(data) {
    // Process each SKU individually (no aggregation)
    // This is for SKU-level analytics showing each size separately
    const skuData = [];

    data.forEach(item => {
      const sku = item.sku || '';
      const artikelnummer = sku.split('\\')[0] || sku;
      const størrelse = this.parseSizeFromSku(sku);

      // Use product title from SKU data (Danish language from SKU table)
      const titleToUse = item.product_title || '';
      const parsedTitle = this.parseProductTitle(titleToUse);

      const quantity = item.quantity || 0;
      const refunded = item.refunded_qty || 0;
      // price_dkk is already the discounted unit price (from discountedUnitPriceSet)
      // It already includes ALL discounts (line-level + order-level), so we don't subtract discount_per_unit_dkk
      const revenue = (item.price_dkk || 0) * quantity || 0;

      skuData.push({
        sku: sku,
        program: parsedTitle.program,
        produkt: parsedTitle.produkt,
        farve: parsedTitle.farve,
        artikelnummer: artikelnummer,
        størrelse: størrelse,
        season: '', // Will be populated from metadata later
        gender: '', // Will be populated from metadata later
        totalQuantity: quantity,
        totalRefunded: refunded,
        totalRevenue: revenue,
        avgPrice: quantity > 0 ? (revenue / quantity).toFixed(2) : 0,
        refundRate: quantity > 0 ? ((refunded / quantity) * 100).toFixed(1) : 0,
        shop: item.shop,
        orderCount: 1
      });
    });

    // Sort by revenue descending
    return skuData.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  parseSizeFromSku(sku) {
    // Extract size from SKU (part after backslash)
    // E.g., "100515\216/122" -> "216/122"
    if (!sku || typeof sku !== 'string') return '';

    const parts = sku.split('\\');
    if (parts.length > 1) {
      return parts[1] || '';
    }
    return '';
  }

  processStyleAnalytics(data, groupBy) {
    const grouped = {};

    data.forEach(item => {
      const metadata = item.product_metadata || {};
      const key = metadata[groupBy] || `Unknown ${groupBy}`;

      if (!grouped[key]) {
        grouped[key] = {
          groupKey: key,
          totalQuantity: 0,
          totalRefunded: 0,
          totalRevenue: 0,
          uniqueSkus: new Set(),
          orderCount: 0,
          avgPrice: 0
        };
      }

      const group = grouped[key];
      const quantity = item.quantity || 0;
      const refunded = item.refunded_qty || 0;
      const price = item.price_dkk || 0;

      group.totalQuantity += quantity;
      group.totalRefunded += refunded;
      group.totalRevenue += price * quantity;
      group.uniqueSkus.add(item.sku);
      group.orderCount++;
    });

    // Calculate averages and format
    return Object.values(grouped).map(group => ({
      ...group,
      uniqueSkus: group.uniqueSkus.size,
      netQuantity: group.totalQuantity - group.totalRefunded,
      avgPrice: group.totalQuantity > 0 ? (group.totalRevenue / group.totalQuantity).toFixed(2) : 0,
      refundRate: group.totalQuantity > 0 ? ((group.totalRefunded / group.totalQuantity) * 100).toFixed(1) : 0
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);
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
    status = null,
    program = null,
    season = null,
    gender = null,
    groupBy = 'status',
    limit = 10000,
    offset = 0,
    includeTotals = 'false',
    startDate = null,
    endDate = null,
    shop = null
  } = req.query;

  // Support POST for updates and complex queries
  if (req.method === 'POST' && req.body) {
    type = req.body.type || type;
    sku = req.body.sku || sku;
    search = req.body.search || search;
    status = req.body.status || status;
    program = req.body.program || program;
    season = req.body.season || season;
    gender = req.body.gender || gender;
    groupBy = req.body.groupBy || groupBy;
    limit = req.body.limit || limit;
    offset = req.body.offset || offset;
    includeTotals = req.body.includeTotals || includeTotals;
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    shop = req.body.shop || shop;
  }

  console.log(`📋 Metadata request: ${type}${sku ? ` SKU: ${sku}` : ''}${search ? ` search: ${search}` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const parsedIncludeTotals = includeTotals === 'true' || includeTotals === true;
    const parsedLimit = Math.min(parseInt(limit) || 1000, 5000);
    const parsedOffset = parseInt(offset) || 0;

    let data, count, hasMore;

    switch (type.toLowerCase()) {
      case 'list':
      case 'raw':
        // Get product metadata
        const result = await supabaseService.getProductMetadata({
          sku,
          search,
          status,
          program,
          season,
          gender,
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
        // Get metadata analytics
        data = await supabaseService.getMetadataAnalytics({ groupBy });
        count = data.summary.totalProducts;
        hasMore = false;
        break;

      case 'style':
        // Get style analytics with metadata
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters for style analytics: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        const styleStart = new Date(startDate);
        const styleEnd = new Date(endDate);

        data = await supabaseService.getStyleAnalytics(styleStart, styleEnd, {
          groupBy,
          shop
        });
        count = data.length;
        hasMore = false;
        break;

      case 'enrich':
        // Enrich SKU data with metadata
        if (!startDate || !endDate) {
          return res.status(400).json({
            error: 'Missing required parameters for enrichment: startDate and endDate',
            example: { startDate: '2024-01-01', endDate: '2024-12-31' }
          });
        }

        if (!req.body.skus || !Array.isArray(req.body.skus)) {
          return res.status(400).json({
            error: 'Missing SKU list for enrichment',
            example: { skus: ['ABC123', 'DEF456'] }
          });
        }

        const enrichStart = new Date(startDate);
        const enrichEnd = new Date(endDate);

        data = await supabaseService.enrichSkuData(req.body.skus, enrichStart, enrichEnd);
        count = data.length;
        hasMore = false;
        break;

      case 'update':
        // Update metadata (POST only)
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed. Use POST for updates.' });
        }

        if (!req.body.metadata || !Array.isArray(req.body.metadata)) {
          return res.status(400).json({
            error: 'Missing metadata',
            expected: { metadata: [{ sku: 'ABC123', product_title: 'Test', status: 'ACTIVE' }] }
          });
        }

        const updateResult = await supabaseService.updateProductMetadata(req.body.metadata);
        data = { updated: updateResult.count };
        count = updateResult.count;
        hasMore = false;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid type',
          validTypes: ['list', 'raw', 'analytics', 'summary', 'style', 'enrich', 'update']
        });
    }

    console.log(`✅ Metadata completed: ${count} records`);

    // Format response for Google Sheets compatibility
    let responseData = data;

    if (type === 'list' && Array.isArray(data)) {
      // Convert to Google Sheets format (array of arrays)
      responseData = data.map(item => [
        item.sku,
        item.product_title,
        item.variant_title,
        item.status,
        item.cost,
        item.program,
        item.produkt,
        item.farve,
        item.season,
        item.gender,
        item.størrelse
      ]);
    }

    // Return success response
    return res.status(200).json({
      success: true,
      type,
      count,
      data: responseData,
      pagination: !['analytics', 'update', 'style', 'enrich'].includes(type) ? {
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
        sku: sku || 'all',
        search: search || null,
        status: status || 'all',
        program: program || 'all',
        season: season || 'all',
        gender: gender || 'all',
        groupBy: ['analytics', 'style'].includes(type) ? groupBy : undefined,
        shop: ['style'].includes(type) ? (shop || 'all') : undefined
      },
      timestamp: new Date().toISOString(),
      ...(type === 'list' && responseData.length > 0 ? {
        headers: [
          'SKU', 'Product Title', 'Variant Title', 'Status', 'Cost',
          'Program', 'Produkt', 'Farve', 'Season', 'Gender', 'Størrelse'
        ]
      } : {})
    });

  } catch (error) {
    console.error('💥 Metadata error:', error);

    return res.status(500).json({
      error: error.message,
      type,
      filters: { sku: sku || 'all', search: search || null },
      timestamp: new Date().toISOString()
    });
  }
};