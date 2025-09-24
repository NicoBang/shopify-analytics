// api/sync-shop.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Inline configuration for Vercel
const CONFIG = {
  SHOPS: [
    { domain: "pompdelux-da.myshopify.com", token: process.env.SHOPIFY_TOKEN_DA, currency: 'DKK', rate: 1.0 },
    { domain: "pompdelux-de.myshopify.com", token: process.env.SHOPIFY_TOKEN_DE, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-nl.myshopify.com", token: process.env.SHOPIFY_TOKEN_NL, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-int.myshopify.com", token: process.env.SHOPIFY_TOKEN_INT, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-chf.myshopify.com", token: process.env.SHOPIFY_TOKEN_CHF, currency: 'CHF', rate: 6.84 }
  ],
  CUTOFF_DATE: new Date('2024-09-30'),
  CHUNK_DAYS: 30,
  MAX_ORDERS_PER_PAGE: 250,
  MAX_LINE_ITEMS: 100,
  RATE_LIMIT_MS: 250,
  API_VERSION: '2024-10'
};

// Inline ShopifyAPIClient for Vercel
class ShopifyAPIClient {
  constructor(shop) {
    this.shop = shop;
    this.endpoint = `https://${shop.domain}/admin/api/${CONFIG.API_VERSION}/graphql.json`;
    this.headers = {
      'X-Shopify-Access-Token': shop.token,
      'Content-Type': 'application/json'
    };
    this.rate = shop.rate || 1;
  }

  async query(queryString, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          this.endpoint,
          { query: queryString },
          { headers: this.headers }
        );

        if (response.data.errors) {
          throw new Error(response.data.errors[0].message);
        }

        return response.data.data;
      } catch (error) {
        if (error.response?.status === 429 && attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }

        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // Sleep helper function
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testConnection() {
    const query = `query { shop { name currencyCode } }`;
    const data = await this.query(query);
    return data.shop;
  }

  // FETCH ORDERS FUNKTION
  async fetchOrders(startDate, endDate) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
    const output = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              shippingAddress { countryCode }
              currentTotalPriceSet { shopMoney { amount } }
              subtotalPriceSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              originalTotalPriceSet { shopMoney { amount } }
              shippingLines(first: 1) {
                edges {
                  node {
                    price
                    taxLines {
                      rate
                      price
                    }
                  }
                }
              }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges { node { quantity } }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const o = edge.node;

          // Udregn fragt ekskl. moms
          const shippingLines = o.shippingLines?.edges || [];
          let shippingExVat = 0;

          shippingLines.forEach(line => {
            const gross = parseFloat(line.node.price || 0);
            const tax = (line.node.taxLines || []).reduce(
              (sum, tl) => sum + parseFloat(tl.price || 0),
              0
            );
            shippingExVat += gross - tax;
          });

          // Beregn refund info
          let totalRefundedAmount = 0;
          let totalRefundedQty = 0;
          let lastRefundDate = "";

          o.refunds.forEach(r => {
            const refundTotal = parseFloat(r.totalRefundedSet?.shopMoney?.amount || 0);
            totalRefundedAmount += refundTotal;

            const refundQty = r.refundLineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0);
            totalRefundedQty += refundQty;

            if (r.createdAt > lastRefundDate) {
              lastRefundDate = r.createdAt;
            }
          });

          // Beregn værdier
          const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0);
          const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
          const totalDiscountsInclTax = parseFloat(o.totalDiscountsSet?.shopMoney?.amount || 0);

          // Beregn rabat ekskl. moms
          let totalDiscountsExTax = totalDiscountsInclTax;
          if (subtotal > 0 && totalTax > 0) {
            const shippingTax = shippingExVat * 0.25;
            const productTax = totalTax - shippingTax;
            const productSubtotalExTax = subtotal - productTax;

            if (productSubtotalExTax > 0) {
              const taxRateOnProducts = productTax / productSubtotalExTax;
              totalDiscountsExTax = totalDiscountsInclTax / (1 + taxRateOnProducts);
            }
          }

          // Beregn sale discount og combined discount
          const originalTotal = parseFloat(o.originalTotalPriceSet?.shopMoney?.amount || 0);
          const currentTotal = parseFloat(o.currentTotalPriceSet?.shopMoney?.amount || 0);
          const saleDiscountTotal = (originalTotal - currentTotal) * this.rate;
          const combinedDiscountTotal = (totalDiscountsInclTax + saleDiscountTotal) * this.rate;

          // Tilføj til output array
          output.push({
            orderId: o.id.replace('gid://shopify/Order/', ''),
            createdAt: o.createdAt,
            country: o.shippingAddress?.countryCode || "Unknown",
            discountedTotal: subtotal * this.rate,
            tax: totalTax * this.rate,
            shipping: shippingExVat * this.rate,
            itemCount: o.lineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0),
            refundedAmount: totalRefundedAmount * this.rate,
            refundedQty: totalRefundedQty,
            refundDate: lastRefundDate,
            totalDiscountsExTax: totalDiscountsExTax * this.rate,
            cancelledQty: 0, // Simplified for nu
            saleDiscountTotal: saleDiscountTotal,
            combinedDiscountTotal: combinedDiscountTotal
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchOrders: ${err.message}`);
    }

    return output;
  }

  // FETCH SKU DATA FUNKTION
  async fetchSkuData(startDate, endDate, excludeSkus = new Set()) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
    const output = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              shippingAddress { countryCode }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges {
                  node {
                    sku
                    product { title }
                    title
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    discountedUnitPriceSet { shopMoney { amount } }
                  }
                }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      lineItem { sku }
                      quantity
                      priceSet { shopMoney { amount } }
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const orderId = order.id.replace('gid://shopify/Order/', '');
          const country = order.shippingAddress?.countryCode || "Unknown";

          // Process line items
          order.lineItems.edges.forEach(lineItemEdge => {
            const item = lineItemEdge.node;
            if (!item.sku || excludeSkus.has(item.sku)) return;

            // Calculate refunded and cancelled quantities for this SKU
            let refundedQty = 0;
            let cancelledQty = 0;
            let lastRefundDate = "";

            order.refunds.forEach(refund => {
              const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount || 0);

              refund.refundLineItems.edges.forEach(refundEdge => {
                if (refundEdge.node.lineItem?.sku === item.sku) {
                  const qty = refundEdge.node.quantity || 0;

                  if (refundTotal > 0) {
                    // Faktisk refund - kunden har fået penge retur
                    refundedQty += qty;
                    if (refund.createdAt > lastRefundDate) {
                      lastRefundDate = refund.createdAt;
                    }
                  } else {
                    // Cancellation - items fjernet før betaling
                    cancelledQty += qty;
                  }
                }
              });
            });

            // Calculate price in DKK
            const unitPrice = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || 0);
            const priceDkk = unitPrice * this.rate;

            output.push({
              shop: this.shop.domain,
              order_id: orderId,
              sku: item.sku,
              created_at: order.createdAt,
              country: country,
              product_title: item.product?.title || "",
              variant_title: item.title || "",
              quantity: item.quantity || 0,
              refunded_qty: refundedQty,
              cancelled_qty: cancelledQty,
              price_dkk: priceDkk,
              refund_date: lastRefundDate || null
            });
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchSkuData: ${err.message}`);
    }

    return output;
  }

  // FETCH INVENTORY FUNKTION
  async fetchInventory() {
    const output = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        productVariants(first: 250${cursorVal ? `, after: "${cursorVal}"` : ""}) {
          edges {
            cursor
            node {
              sku
              inventoryQuantity
              product {
                title
                status
              }
              title
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.productVariants.edges || [];

        edges.forEach(edge => {
          const variant = edge.node;
          if (variant.sku) {
            output.push({
              sku: variant.sku,
              quantity: variant.inventoryQuantity || 0,
              productTitle: variant.product?.title || "",
              variantTitle: variant.title || "",
              status: variant.product?.status || "ACTIVE"
            });
          }
        });

        if (!data.productVariants.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchInventory: ${err.message}`);
    }

    return output;
  }

  // FETCH FULFILLMENTS FUNKTION
  async fetchFulfillments(startDate, endDate) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
    const output = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              shippingAddress { countryCode }
              fulfillments {
                createdAt
                trackingCompany
                lineItems(first: 100) {
                  edges {
                    node {
                      quantity
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;

          order.fulfillments.forEach(fulfillment => {
            const itemCount = fulfillment.lineItems.edges.reduce(
              (sum, lineItem) => sum + (lineItem.node.quantity || 0),
              0
            );

            output.push({
              orderId: order.id.replace('gid://shopify/Order/', ''),
              date: fulfillment.createdAt,
              country: order.shippingAddress?.countryCode || "Unknown",
              carrier: fulfillment.trackingCompany || "Unknown",
              itemCount: itemCount
            });
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchFulfillments: ${err.message}`);
    }

    return output;
  }
}

// Inline SupabaseService for Vercel
class SupabaseService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async testConnection() {
    const { data, error } = await this.supabase
      .from('sync_log')
      .select('count')
      .limit(1);

    if (error) throw error;
    return { success: true, message: 'Supabase connection successful' };
  }

  // Insert/update orders
  async upsertOrders(orders) {
    if (!orders || orders.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${orders.length} orders to Supabase...`);

    // Transform orders to match database schema
    const dbOrders = orders.map(order => ({
      shop: order.shop || 'unknown',
      order_id: order.orderId.replace('gid://shopify/Order/', ''),
      created_at: order.createdAt,
      country: order.country,
      discounted_total: order.discountedTotal,
      tax: order.tax,
      shipping: order.shipping,
      item_count: order.itemCount,
      refunded_amount: order.refundedAmount || 0,
      refunded_qty: order.refundedQty || 0,
      refund_date: order.refundDate || null,
      total_discounts_ex_tax: order.totalDiscountsExTax || 0,
      cancelled_qty: order.cancelledQty || 0,
      sale_discount_total: order.saleDiscountTotal || 0,
      combined_discount_total: order.combinedDiscountTotal || 0,
      raw_data: order,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('orders')
      .upsert(dbOrders, {
        onConflict: 'shop,order_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting orders:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${orders.length} orders`);
    return { count: orders.length, data };
  }

  // Insert/update SKUs
  async upsertSkus(skus) {
    if (!skus || skus.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${skus.length} SKUs to Supabase...`);

    const { data, error } = await this.supabase
      .from('skus')
      .upsert(skus, {
        onConflict: 'shop,order_id,sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting SKUs:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${skus.length} SKUs`);
    return { count: skus.length, data };
  }

  // Insert/update fulfillments
  async upsertFulfillments(fulfillments) {
    if (!fulfillments || fulfillments.length === 0) return { count: 0 };

    console.log(`🚚 Upserting ${fulfillments.length} fulfillments to Supabase...`);

    const { data, error } = await this.supabase
      .from('fulfillments')
      .upsert(fulfillments, {
        onConflict: 'order_id,date',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting fulfillments:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${fulfillments.length} fulfillments`);
    return { count: fulfillments.length, data };
  }

  // Update inventory
  async updateInventory(inventory) {
    if (!inventory || inventory.length === 0) return { count: 0 };

    console.log(`📦 Updating ${inventory.length} inventory items...`);

    const dbInventory = inventory.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      last_updated: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('inventory')
      .upsert(dbInventory, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error updating inventory:', error);
      throw error;
    }

    console.log(`✅ Successfully updated ${inventory.length} inventory items`);
    return { count: inventory.length, data };
  }

  async logSync(shop, syncType, recordsSynced, errorMessage = null) {
    const logEntry = {
      shop,
      sync_type: syncType,
      records_synced: recordsSynced,
      completed_at: new Date().toISOString(),
      status: errorMessage ? 'failed' : 'completed',
      error_message: errorMessage
    };

    await this.supabase.from('sync_log').insert([logEntry]);
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
  let { shop: shopDomain, type = 'orders', days = 7, startDate, endDate } = req.query;

  // Also support POST body parameters
  if (req.method === 'POST' && req.body) {
    shopDomain = req.body.shop || shopDomain;
    type = req.body.type || type;
    days = req.body.days || days;
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
  }

  if (!shopDomain) {
    return res.status(400).json({
      error: 'Missing required parameter: shop domain',
      example: 'pompdelux-da.myshopify.com'
    });
  }

  // Log sync parameters
  if (startDate && endDate) {
    console.log(`🚀 Starting sync: ${type} for ${shopDomain} (${startDate} to ${endDate})`);
  } else {
    console.log(`🚀 Starting sync: ${type} for ${shopDomain} (${days} days)`);
  }

  try {
    // Find shop configuration
    const shop = CONFIG.SHOPS.find(s => s.domain === shopDomain);
    if (!shop) {
      return res.status(400).json({
        error: 'Invalid shop domain',
        availableShops: CONFIG.SHOPS.map(s => s.domain)
      });
    }

    // Initialize services
    const shopifyClient = new ShopifyAPIClient(shop);
    const supabaseService = new SupabaseService();

    // Test connections
    console.log('🔍 Testing connections...');
    await shopifyClient.testConnection();
    await supabaseService.testConnection();

    // Calculate date range - support both days and explicit dates
    let syncStartDate, syncEndDate;

    if (startDate && endDate) {
      // Use explicit date range
      syncStartDate = new Date(startDate);
      syncEndDate = new Date(endDate);

      // Validate dates
      if (isNaN(syncStartDate.getTime()) || isNaN(syncEndDate.getTime())) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD format',
          examples: { startDate: '2024-09-30', endDate: '2024-10-31' }
        });
      }

      if (syncStartDate >= syncEndDate) {
        return res.status(400).json({
          error: 'startDate must be before endDate'
        });
      }
    } else {
      // Use days parameter (backward compatibility)
      syncEndDate = new Date();
      syncStartDate = new Date();
      syncStartDate.setDate(syncStartDate.getDate() - Number(days));
    }

    console.log(`📅 Syncing from ${syncStartDate.toISOString().split('T')[0]} to ${syncEndDate.toISOString().split('T')[0]}`);

    let recordsSynced = 0;
    let syncData = null;

    // Execute sync based on type
    switch (type.toLowerCase()) {
      case 'orders':
        console.log('📦 Fetching orders...');
        const orders = await shopifyClient.fetchOrders(syncStartDate, syncEndDate);

        // Add shop domain to each order
        orders.forEach(order => order.shop = shopDomain);

        console.log('💾 Saving to Supabase...');
        const orderResult = await supabaseService.upsertOrders(orders);
        recordsSynced = orderResult.count;
        syncData = { ordersFound: orders.length };
        break;

      case 'skus':
        console.log('🏷️ Fetching SKU data...');
        const skus = await shopifyClient.fetchSkuData(syncStartDate, syncEndDate);

        // Deduplikér SKU data INDEN for samme batch
        // Men lad PostgreSQL håndtere opdateringer af eksisterende rækker
        console.log(`📊 Processing ${skus.length} SKUs...`);
        const uniqueSkusMap = skus.reduce((map, item) => {
          const key = `${item.shop}-${item.order_id}-${item.sku}`;
          const existing = map.get(key);

          // Inden for samme batch: behold den nyeste/mest komplette version
          if (!existing) {
            map.set(key, item);
          } else {
            // Prioritér:
            // 1. Post med refund_date (nyeste hvis flere)
            // 2. Post med højeste refunded_qty
            // 3. Behold eksisterende
            if (item.refund_date && (!existing.refund_date || item.refund_date > existing.refund_date)) {
              map.set(key, item);
            } else if (!item.refund_date && !existing.refund_date && item.refunded_qty > existing.refunded_qty) {
              map.set(key, item);
            }
          }

          return map;
        }, new Map());

        const uniqueSkus = Array.from(uniqueSkusMap.values());
        const duplicatesInBatch = skus.length - uniqueSkus.length;

        if (duplicatesInBatch > 0) {
          console.log(`✨ Removed ${duplicatesInBatch} duplicates within batch`);
        }

        console.log('💾 Upserting to Supabase (will update existing records)...');
        const skuResult = await supabaseService.upsertSkus(uniqueSkus);
        recordsSynced = skuResult.count;
        syncData = {
          skusFound: skus.length,
          uniqueSkus: uniqueSkus.length,
          duplicatesRemoved: duplicatesInBatch
        };
        break;

      case 'inventory':
        console.log('📦 Fetching inventory...');
        const inventory = await shopifyClient.fetchInventory();

        console.log('💾 Updating Supabase...');
        const invResult = await supabaseService.updateInventory(inventory);
        recordsSynced = invResult.count;
        syncData = { inventoryItems: inventory.length };
        break;

      case 'fulfillments':
        console.log('🚚 Fetching fulfillments...');
        const fulfillments = await shopifyClient.fetchFulfillments(syncStartDate, syncEndDate);

        console.log('💾 Saving to Supabase...');
        const fulfillmentResult = await supabaseService.upsertFulfillments(fulfillments);
        recordsSynced = fulfillmentResult.count;
        syncData = { fulfillmentsFound: fulfillments.length };
        break;

      default:
        return res.status(400).json({
          error: 'Invalid sync type',
          validTypes: ['orders', 'skus', 'inventory', 'fulfillments']
        });
    }

    // Log the sync operation
    console.log('📊 Logging sync operation...');
    await supabaseService.logSync(shopDomain, type, recordsSynced);

    console.log(`✅ Sync completed: ${recordsSynced} records`);

    // Return success response
    return res.status(200).json({
      success: true,
      shop: shopDomain,
      type,
      recordsSynced,
      period: {
        startDate: syncStartDate.toISOString(),
        endDate: syncEndDate.toISOString(),
        days: startDate && endDate ? Math.ceil((syncEndDate - syncStartDate) / (1000 * 60 * 60 * 24)) : Number(days)
      },
      data: syncData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Sync error:', error);

    // Log failed sync
    try {
      const supabaseService = new SupabaseService();
      await supabaseService.logSync(shopDomain, type, 0, error.message);
    } catch (logError) {
      console.error('💥 Error logging failed sync:', logError);
    }

    return res.status(500).json({
      error: error.message,
      shop: shopDomain,
      type,
      timestamp: new Date().toISOString()
    });
  }
};