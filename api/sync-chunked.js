// api/sync-chunked.js
// Chunked sync endpoint to avoid Vercel timeouts
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Inline configuration
const CONFIG = {
  SHOPS: [
    { domain: "pompdelux-da.myshopify.com", token: process.env.SHOPIFY_TOKEN_DA, currency: 'DKK', rate: 1.0 },
    { domain: "pompdelux-de.myshopify.com", token: process.env.SHOPIFY_TOKEN_DE, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-nl.myshopify.com", token: process.env.SHOPIFY_TOKEN_NL, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-int.myshopify.com", token: process.env.SHOPIFY_TOKEN_INT, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-chf.myshopify.com", token: process.env.SHOPIFY_TOKEN_CHF, currency: 'CHF', rate: 6.84 }
  ],
  CHUNK_DAYS: 7,  // Process 7 days at a time to avoid timeout
  MAX_RUNTIME_MS: 55000,  // Stop at 55 seconds (Vercel limit is 60)
  MAX_ORDERS_PER_PAGE: 100,  // Smaller page size for faster processing
  RATE_LIMIT_MS: 200,
  API_VERSION: '2024-10'
};

// Lightweight Shopify client for chunked processing
class ShopifyChunkedClient {
  constructor(shop) {
    this.shop = shop;
    this.endpoint = `https://${shop.domain}/admin/api/${CONFIG.API_VERSION}/graphql.json`;
    this.headers = {
      'X-Shopify-Access-Token': shop.token,
      'Content-Type': 'application/json'
    };
    this.rate = shop.rate || 1;
    this.startTime = Date.now();
  }

  // Check if we're approaching timeout
  shouldStop() {
    return (Date.now() - this.startTime) > CONFIG.MAX_RUNTIME_MS;
  }

  async query(queryString, retries = 2) {
    if (this.shouldStop()) {
      throw new Error('Approaching timeout limit');
    }

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
        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }

  async fetchSkuChunk(startDate, endDate) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const output = [];
    let cursor = null;
    let pageCount = 0;
    const maxPages = 10; // Limit pages per chunk

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""},
               query: "created_at:>=${isoStart} created_at:<=${isoEnd}") {
          edges {
            cursor
            node {
              id
              createdAt
              shippingAddress { countryCode }
              lineItems(first: 50) {
                edges {
                  node {
                    sku
                    product { title }
                    title
                    quantity
                    discountedUnitPriceSet { shopMoney { amount } }
                  }
                }
              }
              refunds {
                createdAt
                refundLineItems(first: 50) {
                  edges {
                    node {
                      lineItem { sku }
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
      while (pageCount < maxPages && !this.shouldStop()) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const orderId = order.id.replace('gid://shopify/Order/', '');
          const country = order.shippingAddress?.countryCode || "Unknown";

          // Process line items
          order.lineItems.edges.forEach(lineItemEdge => {
            const item = lineItemEdge.node;
            if (!item.sku) return;

            // Calculate refunds for this SKU
            let refundedQty = 0;
            let lastRefundDate = "";

            order.refunds.forEach(refund => {
              refund.refundLineItems.edges.forEach(refundEdge => {
                if (refundEdge.node.lineItem?.sku === item.sku) {
                  refundedQty += refundEdge.node.quantity || 0;
                  if (refund.createdAt > lastRefundDate) {
                    lastRefundDate = refund.createdAt;
                  }
                }
              });
            });

            const unitPrice = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || 0);

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
              price_dkk: unitPrice * this.rate,
              refund_date: lastRefundDate || null
            });
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1]?.cursor;
        pageCount++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
      }

    } catch (err) {
      console.log(`⚠️ Chunk processing stopped: ${err.message}`);
    }

    return output;
  }
}

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Validate request
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return null;
}

// Process a single chunk
async function processChunk(shop, startDate, endDate) {
  console.log(`📦 Processing chunk: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  const client = new ShopifyChunkedClient(shop);
  const skus = await client.fetchSkuChunk(startDate, endDate);

  if (skus.length === 0) {
    console.log('⚠️ No SKUs found in this chunk');
    return { processed: 0, saved: 0 };
  }

  // Remove duplicates within chunk
  const uniqueMap = new Map();
  skus.forEach(item => {
    const key = `${item.shop}-${item.order_id}-${item.sku}`;
    if (!uniqueMap.has(key) || item.refund_date > uniqueMap.get(key).refund_date) {
      uniqueMap.set(key, item);
    }
  });

  const uniqueSkus = Array.from(uniqueMap.values());
  console.log(`📊 Found ${skus.length} SKUs, ${uniqueSkus.length} unique`);

  // Save to database - REPLACE old records when we have refund updates
  // This ensures that refunded orders always replace the original order record
  const { data, error } = await supabase
    .from('skus')
    .upsert(uniqueSkus, {
      onConflict: 'shop,order_id,sku',
      ignoreDuplicates: false,
      // IMPORTANT: This replaces the old record with the new one
      // So when a refund comes in, it updates the existing record
    });

  if (error) {
    console.error('❌ Database error:', error);
    throw error;
  }

  return {
    processed: skus.length,
    saved: uniqueSkus.length,
    duplicates: skus.length - uniqueSkus.length
  };
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  const { shop: shopDomain, startDate, endDate, chunkIndex = 0 } = req.query;

  if (!shopDomain || !startDate || !endDate) {
    return res.status(400).json({
      error: 'Missing required parameters: shop, startDate, endDate',
      example: '?shop=pompdelux-da.myshopify.com&startDate=2025-01-01&endDate=2025-03-31'
    });
  }

  try {
    // Find shop configuration
    const shop = CONFIG.SHOPS.find(s => s.domain === shopDomain);
    if (!shop) {
      return res.status(400).json({ error: 'Invalid shop domain' });
    }

    // Parse dates
    const fullStartDate = new Date(startDate);
    const fullEndDate = new Date(endDate);

    // Calculate chunks
    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDays = Math.ceil((fullEndDate - fullStartDate) / msPerDay);
    const totalChunks = Math.ceil(totalDays / CONFIG.CHUNK_DAYS);
    const currentChunkIndex = parseInt(chunkIndex);

    // Calculate chunk boundaries
    const chunkStartDate = new Date(fullStartDate);
    chunkStartDate.setDate(chunkStartDate.getDate() + (currentChunkIndex * CONFIG.CHUNK_DAYS));

    const chunkEndDate = new Date(chunkStartDate);
    chunkEndDate.setDate(chunkEndDate.getDate() + CONFIG.CHUNK_DAYS - 1);

    // Don't exceed the requested end date
    if (chunkEndDate > fullEndDate) {
      chunkEndDate.setTime(fullEndDate.getTime());
    }

    // Check if we've processed all chunks
    if (chunkStartDate > fullEndDate) {
      return res.status(200).json({
        success: true,
        message: 'All chunks processed',
        shop: shopDomain,
        totalChunks,
        completedAt: new Date().toISOString()
      });
    }

    console.log(`🚀 Processing chunk ${currentChunkIndex + 1}/${totalChunks} for ${shopDomain}`);

    // Process this chunk
    const result = await processChunk(shop, chunkStartDate, chunkEndDate);

    // Prepare response
    const response = {
      success: true,
      shop: shopDomain,
      chunk: {
        index: currentChunkIndex,
        total: totalChunks,
        startDate: chunkStartDate.toISOString().split('T')[0],
        endDate: chunkEndDate.toISOString().split('T')[0],
        processed: result.processed,
        saved: result.saved,
        duplicates: result.duplicates
      },
      nextChunk: currentChunkIndex + 1 < totalChunks ? {
        index: currentChunkIndex + 1,
        url: `/api/sync-chunked?shop=${shopDomain}&startDate=${startDate}&endDate=${endDate}&chunkIndex=${currentChunkIndex + 1}`
      } : null,
      progress: `${Math.round(((currentChunkIndex + 1) / totalChunks) * 100)}%`,
      timestamp: new Date().toISOString()
    };

    // Log to sync_log
    await supabase.from('sync_log').insert([{
      shop: shopDomain,
      sync_type: `skus_chunk_${currentChunkIndex}`,
      records_synced: result.saved,
      completed_at: new Date().toISOString(),
      status: 'completed',
      error_message: null
    }]);

    return res.status(200).json(response);

  } catch (error) {
    console.error('💥 Sync error:', error);

    // Log error
    try {
      await supabase.from('sync_log').insert([{
        shop: shopDomain,
        sync_type: 'skus_chunk_error',
        records_synced: 0,
        completed_at: new Date().toISOString(),
        status: 'failed',
        error_message: error.message
      }]);
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return res.status(500).json({
      error: error.message,
      shop: shopDomain,
      timestamp: new Date().toISOString()
    });
  }
};