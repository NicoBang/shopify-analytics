// api/batch-resync-skus.js
// Async batch resync service for SKU cancelled_amount_dkk field
// Handles historical data re-sync without hitting Vercel timeout limits

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Inline configuration
const CONFIG = {
  SHOPS: [
    { domain: "pompdelux-da.myshopify.com", token: process.env.SHOPIFY_TOKEN_DA, currency: 'DKK', rate: 1.0 },
    { domain: "pompdelux-de.myshopify.com", token: process.env.SHOPIFY_TOKEN_DE, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-nl.myshopify.com", token: process.env.SHOPIFY_TOKEN_NL, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-int.myshopify.com", token: process.env.SHOPIFY_TOKEN_INT, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-chf.myshopify.com", token: process.env.SHOPIFY_TOKEN_CHF, currency: 'CHF', rate: 6.84 }
  ],
  MAX_LINE_ITEMS: 250,
  RATE_LIMIT_MS: 250,
  API_VERSION: '2024-10'
};

// Simple Shopify API client for fetching order refund data
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Fetch order with refund data for specific order ID
  async fetchOrderRefundData(orderId) {
    const query = `
      query {
        order(id: "gid://shopify/Order/${orderId}") {
          id
          taxesIncluded
          lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
            edges {
              node {
                sku
                taxLines {
                  rate
                  priceSet {
                    shopMoney {
                      amount
                    }
                  }
                }
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
    `;

    try {
      const data = await this.query(query);
      return data.order;
    } catch (err) {
      console.error(`Error fetching order ${orderId}: ${err.message}`);
      return null;
    }
  }
}

// Calculate cancelled amount for a specific SKU in an order
function calculateCancelledAmount(order, sku, shopRate) {
  if (!order || !order.refunds) return 0;

  const taxesIncluded = order.taxesIncluded || false;
  let cancelledAmountDkk = 0;

  // Get tax rate for this SKU from line items
  const lineItem = order.lineItems.edges.find(e => e.node.sku === sku);
  const defaultTaxRate = (lineItem?.node?.taxLines?.[0]?.rate) || 0.25;

  order.refunds.forEach(refund => {
    const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount || 0);

    // Only process cancellations (refund total = 0)
    if (refundTotal === 0) {
      // Find refund line items for this SKU
      const skuRefundItems = refund.refundLineItems.edges
        .filter(e => e.node.lineItem?.sku === sku);

      // Calculate cancelled amount from RefundLineItem.priceSet
      skuRefundItems.forEach(refundItem => {
        const cancelledPrice = parseFloat(refundItem.node.priceSet?.shopMoney?.amount || 0);

        // Convert to EX moms
        let cancelledPriceExTax;
        if (taxesIncluded) {
          cancelledPriceExTax = cancelledPrice / (1 + defaultTaxRate);
        } else {
          cancelledPriceExTax = cancelledPrice;
        }

        // Add to total in DKK
        cancelledAmountDkk += cancelledPriceExTax * shopRate;
      });
    }
  });

  return cancelledAmountDkk;
}

// Process a single batch of SKUs
async function processBatch(supabase, shopClients, skus, offset, limit) {
  console.log(`📦 Processing batch ${offset}-${offset + limit}: ${skus.length} SKUs`);

  let updatedCount = 0;

  for (const sku of skus) {
    try {
      // Find shop client for this SKU
      const shopConfig = CONFIG.SHOPS.find(s => s.domain === sku.shop);
      if (!shopConfig) {
        console.error(`No shop config for ${sku.shop}`);
        continue;
      }

      const shopClient = shopClients[sku.shop];
      if (!shopClient) {
        console.error(`No shop client for ${sku.shop}`);
        continue;
      }

      // Fetch order refund data from Shopify
      const order = await shopClient.fetchOrderRefundData(sku.order_id);
      if (!order) {
        console.error(`Could not fetch order ${sku.order_id}`);
        continue;
      }

      // Calculate cancelled amount
      const cancelledAmount = calculateCancelledAmount(order, sku.sku, shopConfig.rate);

      // Update in Supabase
      const { error } = await supabase
        .from('skus')
        .update({ cancelled_amount_dkk: cancelledAmount })
        .eq('shop', sku.shop)
        .eq('order_id', sku.order_id)
        .eq('sku', sku.sku);

      if (error) {
        console.error(`Error updating SKU ${sku.sku}: ${error.message}`);
      } else {
        updatedCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));

    } catch (error) {
      console.error(`Error processing SKU ${sku.sku}: ${error.message}`);
    }
  }

  console.log(`✅ Batch ${offset}-${offset + limit}: updated ${updatedCount}/${skus.length} SKUs`);
  return updatedCount;
}

// Main async job function
async function runResyncJob(supabase, shopClients, jobId, startDate, endDate, batchSize) {
  console.log(`🚀 Starting resync job ${jobId}`);
  console.log(`   Date range: ${startDate} → ${endDate}`);
  console.log(`   Batch size: ${batchSize}`);

  try {
    // Count total SKUs to process
    console.log(`📆 Filtering SKUs by created_at between ${startDate} and ${endDate}`);
    console.log(`🔍 Query conditions: cancelled_amount_dkk IS NULL OR = 0, cancelled_qty > 0`);

    const { count, error: countError } = await supabase
      .from('skus')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .or('cancelled_amount_dkk.is.null,cancelled_amount_dkk.eq.0')
      .gt('cancelled_qty', 0); // Only process SKUs with cancelled items

    if (countError) {
      throw new Error(`Count error: ${countError.message}`);
    }

    console.log(`📊 Found ${count} SKUs to process`);

    // Defensive check: warn if no SKUs found
    if (count === 0) {
      console.warn(`⚠️ No SKUs found matching criteria. Possible causes:`);
      console.warn(`   1. No SKUs exist for this date range (check: SELECT COUNT(*) FROM skus WHERE created_at >= '${startDate}' AND created_at <= '${endDate}')`);
      console.warn(`   2. All SKUs already have cancelled_amount_dkk populated`);
      console.warn(`   3. No SKUs have cancelled_qty > 0 in this period`);
      console.warn(`   → Verify SKU data exists before running batch resync`);
    }

    // Update job with total count
    await supabase
      .from('resync_jobs')
      .update({ total_count: count })
      .eq('id', jobId);

    // Process in batches
    let offset = 0;
    let totalProcessed = 0;

    while (offset < count) {
      // Fetch batch
      console.log(`📦 Fetching batch at offset ${offset} (range: ${offset}-${offset + batchSize - 1})`);

      const { data: skus, error: fetchError } = await supabase
        .from('skus')
        .select('shop, order_id, sku, cancelled_qty')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .or('cancelled_amount_dkk.is.null,cancelled_amount_dkk.eq.0')
        .gt('cancelled_qty', 0)
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        throw new Error(`Fetch error: ${fetchError.message}`);
      }

      if (!skus || skus.length === 0) {
        console.log(`⏹️ No more SKUs to process at offset ${offset}`);
        break;
      }

      console.log(`✅ Fetched ${skus.length} SKUs for processing`);

      // Process batch
      const updatedCount = await processBatch(supabase, shopClients, skus, offset, batchSize);
      totalProcessed += updatedCount;

      // Update job progress
      await supabase
        .from('resync_jobs')
        .update({ processed_count: totalProcessed })
        .eq('id', jobId);

      offset += batchSize;
    }

    // Mark job as completed
    await supabase
      .from('resync_jobs')
      .update({
        status: 'completed',
        processed_count: totalProcessed,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`✅ Job ${jobId} completed: ${totalProcessed}/${count} SKUs updated`);

  } catch (error) {
    console.error(`💥 Job ${jobId} failed: ${error.message}`);

    // Mark job as failed
    await supabase
      .from('resync_jobs')
      .update({
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}

// Vercel serverless handler
module.exports = async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check API key
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.API_SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse request body
  const { startDate, endDate, batchSize = 500 } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from('resync_jobs')
    .insert({
      start_date: startDate,
      end_date: endDate,
      batch_size: batchSize,
      status: 'running'
    })
    .select()
    .single();

  if (jobError) {
    return res.status(500).json({ error: `Failed to create job: ${jobError.message}` });
  }

  const jobId = job.id;

  // Initialize shop clients
  const shopClients = {};
  CONFIG.SHOPS.forEach(shop => {
    shopClients[shop.domain] = new ShopifyAPIClient(shop);
  });

  // Return immediately with job ID
  res.status(202).json({
    jobId: jobId,
    status: 'started',
    message: 'Resync job started. Use GET /api/resync-job-status?jobId=<jobId> to check progress.'
  });

  // Run async job in background (Vercel will keep function alive for up to 60s)
  // For longer jobs, this will run partially and can be resumed by calling again
  setImmediate(() => {
    runResyncJob(supabase, shopClients, jobId, startDate, endDate, batchSize)
      .catch(error => {
        console.error(`Background job error: ${error.message}`);
      });
  });
};
