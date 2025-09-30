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
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .in('sku', skus)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error enriching SKU data:', error);
      throw error;
    }

    // Get metadata separately for the SKUs
    const uniqueArtikelNummers = [...new Set(skus.map(sku => sku.split('\\')[0] || sku))];
    const metadataMap = {};

    if (uniqueArtikelNummers.length > 0) {
      const { data: metadataData } = await this.supabase
        .from('product_metadata')
        .select('*')
        .in('artikelnummer', uniqueArtikelNummers);

      (metadataData || []).forEach(meta => {
        if (meta.artikelnummer) {
          metadataMap[meta.artikelnummer] = meta;
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

    // Ensure we have the full day range - fix same-day queries
    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    console.log(`📅 Style Analytics query: ${adjustedStartDate.toISOString()} to ${adjustedEndDate.toISOString()}`);

    // STEP 1: Fetch sales data (SKUs created in period) - similar to Dashboard API
    console.log(`📊 Step 1: Fetching sales data (created_at in period)...`);
    let salesData = [];
    let hasMore = true;
    let currentOffset = 0;
    const batchSize = 1000;

    while (hasMore) {
      let batchQuery = this.supabase
        .from('skus')
        .select('sku, shop, quantity, refunded_qty, cancelled_qty, price_dkk, created_at, product_title, variant_title, refund_date')
        .gte('created_at', adjustedStartDate.toISOString())
        .lte('created_at', adjustedEndDate.toISOString())
        .order('created_at', { ascending: false })
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

    console.log(`📊 Total sales records fetched: ${salesData.length}`);

    // STEP 2: Fetch refund data (SKUs with refund_date in period) - matching Dashboard API logic
    console.log(`📊 Step 2: Fetching refund data (refund_date in period)...`);
    let refundQuery = this.supabase
      .from('skus')
      .select('sku, shop, quantity, refunded_qty, cancelled_qty, price_dkk, created_at, product_title, variant_title, refund_date')
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

    console.log(`📊 Total refund records fetched: ${refundData?.length || 0}`);

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
    console.log(`📊 Combined total records: ${data.length} (${salesData.length} sales + ${refundData?.length || 0} refunds, with overlap handling)`);

    // Extract unique artikelnummer from SKUs (part before backslash) to match metadata
    const uniqueArtikelNummers = [...new Set((data || []).map(item => {
      const sku = item.sku || '';
      return sku.split('\\')[0] || sku; // Extract artikelnummer before backslash
    }).filter(Boolean))];

    console.log(`📋 Found ${uniqueArtikelNummers.length} unique artikelnummer with sales, fetching ALL metadata...`);

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
          .select('artikelnummer, program, produkt, farve, season, gender, status, cost, varemodtaget, tags, price, compare_at_price, størrelse, product_title, variant_title')
          // Include both ACTIVE and ARCHIVED products to show historical data
          .order('artikelnummer', { ascending: true })
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
            if (meta.artikelnummer) {
              // Extract the base artikelnummer from the SKU (part before backslash)
              const baseArtikelNummer = meta.artikelnummer.split('\\')[0] || meta.artikelnummer;

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

      console.log(`📋 Fetched ${totalFetched} total metadata rows`);
      console.log(`📋 Found ${Object.keys(metadataMap).length} unique artikelnummer with metadata`);
      console.log(`📋 Total artikelnummer (including those without sales): ${uniqueArtikelNummers.length}`);

      // Debug: Check if 100537 is now included
      if (metadataMap['100537']) {
        console.log(`✅ Artikelnummer 100537 found with season=${metadataMap['100537'].season}, gender=${metadataMap['100537'].gender}`);
      } else {
        console.log(`⚠️ Artikelnummer 100537 NOT found in metadata`);
      }

      // Debug: Log a sample metadata item to verify season and gender are present
      if (Object.keys(metadataMap).length > 0) {
        const sampleKey = Object.keys(metadataMap)[0];
        const sampleMeta = metadataMap[sampleKey];
        console.log(`📋 Sample metadata for ${sampleKey}: season=${sampleMeta.season}, gender=${sampleMeta.gender}, status=${sampleMeta.status}`);
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

    console.log(`📊 Found sales data for ${Object.keys(salesByArtikelnummer).length} artikelnummer`);
    console.log(`📋 Total artikelnummer in metadata: ${allArtikelNummers.size}`);

    // Debug: Count data by shop
    const shopCounts = {};
    (data || []).forEach(item => {
      const shop = item.shop || 'Unknown';
      shopCounts[shop] = (shopCounts[shop] || 0) + 1;
    });
    console.log(`🏪 Sales data by shop:`, shopCounts);

    return await this.processBasicStyleAnalytics(salesByArtikelnummer, groupBy, metadataMap, allArtikelNummers);
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
    console.log(`📊 Step 1: Fetching SKU sales data (created_at in period)...`);
    let salesQuery = this.supabase
      .from('skus')
      .select('*')
      .gte('created_at', adjustedStartDate.toISOString())
      .lte('created_at', adjustedEndDate.toISOString());

    if (shop) {
      salesQuery = salesQuery.eq('shop', shop);
    }

    const { data: salesData, error: salesError } = await salesQuery;

    if (salesError) {
      console.error('❌ Error fetching SKU sales data:', salesError);
      throw salesError;
    }

    console.log(`📊 Total SKU sales records fetched: ${salesData?.length || 0}`);

    // STEP 2: Fetch refund data (SKUs with refund_date in period)
    console.log(`📊 Step 2: Fetching SKU refund data (refund_date in period)...`);
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

    console.log(`📊 Total SKU refund records fetched: ${refundData?.length || 0}`);

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
    console.log(`📊 Combined SKU records: ${data.length} (${salesData?.length || 0} sales + ${refundData?.length || 0} refunds, with overlap handling)`);

    // Debug: Count data by shop
    const shopCounts = {};
    data.forEach(item => {
      const shop = item.shop || 'Unknown';
      shopCounts[shop] = (shopCounts[shop] || 0) + 1;
    });
    console.log(`🏪 Combined data by shop:`, shopCounts);

    return this.processSkuAnalytics(data);
  }

  async processBasicStyleAnalytics(salesByArtikelnummer, groupBy, metadataMap = {}, allArtikelNummers = new Set()) {
    // Group by style (artikelnummer) extracted from SKU
    // Aggregate all sizes and shops for each style
    // This replicates the original STYLE_COLOR_Analytics.gs logic
    console.log(`📊 Processing style analytics with ${Object.keys(salesByArtikelnummer).length} artikelnummer with sales`);
    console.log(`📊 Metadata map has ${Object.keys(metadataMap).length} entries`);
    console.log(`📊 Total artikelnummer from metadata: ${allArtikelNummers.size}`);

    // Debug specific artikelnummer
    if (metadataMap['100537']) {
      console.log(`🔍 DEBUG 100537 metadata:`, {
        season: metadataMap['100537'].season,
        gender: metadataMap['100537'].gender,
        status: metadataMap['100537'].status,
        hasSales: salesByArtikelnummer['100537'] ? 'YES' : 'NO'
      });
    }

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

        grouped[artikelnummer] = {
          // Use parsed values for produkt/farve (database fields are empty)
          // Use metadata for season/gender/program
          program: meta.program || parsedTitle.program || '',
          produkt: parsedTitle.produkt || '',  // Always from parsed title
          farve: parsedTitle.farve || '',      // Always from parsed title
          artikelnummer: artikelnummer,
          season: meta.season || '',           // From metadata
          gender: meta.gender || '',           // From metadata
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
        const group = grouped[artikelnummer];
        if (!group) {
          console.warn(`⚠️ No metadata for artikelnummer ${artikelnummer} with sales`);
          return;
        }

        const quantity = item.quantity || 0;
        const refunded = item.refunded_qty || 0;
        const cancelled = item.cancelled_qty || 0;
        const revenue = (item.price_dkk || 0) * quantity;

        // Træk cancelled fra solgt direkte, så vi viser netto solgt
        group.solgt += (quantity - cancelled);
        group.retur += refunded;
        group.cancelled += cancelled;
        group.omsætning += revenue;
        group.shops.add(item.shop);
        group.skus.add(item.sku);

        // DON'T update metadata from item - it should come from metadataMap ONLY
        // The SKU table doesn't have season/gender - those only exist in metadata
        // Only update cost and varemodtaget if they're not set from metadata
        if (item.cost && group.kostpris === 0) {
          group.kostpris = parseFloat(item.cost) || 0;
        }
        if (item.varemodtaget && group.varemodtaget === 0) {
          group.varemodtaget = parseInt(item.varemodtaget) || 0;
        }

        // Always update maxPris to get the highest price across all variants
        if (group.maxPris === undefined) {
          group.maxPris = 0;
        }
        group.maxPris = Math.max(
          group.maxPris,
          parseFloat(item.compare_at_price) || 0,
          parseFloat(item.price_meta) || 0,
          parseFloat(item.price_dkk) || 0
        );
      });
    });

    console.log(`📦 Found ${Object.keys(grouped).length} unique styles, fetching inventory...`);

    // Second pass: get inventory data for each style
    try {
      // Get all inventory data for the style analysis
      const inventoryResult = await this.getInventoryData({
        limit: 5000,
        offset: 0,
        includeTotals: false
      });

      const inventoryData = inventoryResult?.data || [];
      console.log(`📦 Retrieved ${inventoryData.length} inventory records`);

      // Aggregate inventory by style
      const inventoryByStyle = {};
      inventoryData.forEach(invItem => {
        const sku = invItem.sku || '';
        const artikelnummer = sku.split('\\')[0] || sku;

        if (!inventoryByStyle[artikelnummer]) {
          inventoryByStyle[artikelnummer] = 0;
        }
        inventoryByStyle[artikelnummer] += parseInt(invItem.quantity) || 0;
      });

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

      // Get metadata for this artikelnummer to use correct Danish title
      const meta = metadataMap[artikelnummer] || {};
      // Use metadata title instead of SKU title to ensure Danish language
      const titleToUse = meta.product_title || meta.variant_title || item.product_title || '';
      const parsedTitle = this.parseProductTitle(titleToUse);

      const quantity = item.quantity || 0;
      const refunded = item.refunded_qty || 0;
      const revenue = item.price_dkk * quantity || 0;

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