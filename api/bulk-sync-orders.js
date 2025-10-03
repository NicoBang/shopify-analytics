/**
 * Bulk Sync Orders API - Proof of Concept
 *
 * Uses Shopify GraphQL Bulk Operations to fetch large datasets asynchronously.
 * This is a POC endpoint - NOT integrated into daily cron jobs yet.
 *
 * Performance comparison:
 * - Cursor-based sync: ~30-60 seconds for 1000 orders (multiple requests)
 * - Bulk operation: ~10-30 seconds for 1000+ orders (single async job)
 *
 * Usage:
 * GET /api/bulk-sync-orders?shop=pompdelux-da.myshopify.com&startDate=2024-09-01&endDate=2024-09-30
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import readline from 'readline';
import { Readable } from 'stream';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Configuration
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max
const BATCH_SIZE = 500; // Insert 500 orders at a time

// Currency conversion rates (same as sync-shop.js)
const CURRENCY_RATES = {
  'DKK': 1.0,
  'EUR': 7.46,
  'CHF': 6.84
};

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.API_SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { shop, startDate, endDate } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing required parameter: shop' });
  }

  const shopToken = getShopToken(shop);
  if (!shopToken) {
    return res.status(400).json({ error: `Invalid shop: ${shop}` });
  }

  // Default to last 30 days if no dates provided
  const end = endDate || new Date().toISOString().split('T')[0];
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`🚀 Starting bulk operation for ${shop}: ${start} to ${end}`);
  const startTime = Date.now();

  try {
    // Step 1: Start bulk operation
    const bulkOpId = await startBulkOperation(shop, shopToken, start, end);
    console.log(`✅ Bulk operation started: ${bulkOpId}`);

    // Step 2: Poll for completion
    const bulkOpResult = await pollBulkOperationStatus(shop, shopToken, bulkOpId);
    console.log(`✅ Bulk operation completed: ${bulkOpResult.objectCount} objects`);

    // Step 3: Download JSONL
    const orders = await downloadAndParseJSONL(bulkOpResult.url, shop);
    console.log(`✅ Parsed ${orders.length} orders from JSONL`);

    // Step 4: Insert into Supabase
    const recordsSynced = await insertOrdersInBatches(orders);
    console.log(`✅ Inserted ${recordsSynced} orders into Supabase`);

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    return res.status(200).json({
      success: true,
      shop,
      startDate: start,
      endDate: end,
      bulkOperationId: bulkOpId,
      recordsSynced,
      objectCount: bulkOpResult.objectCount,
      fileSize: bulkOpResult.fileSize,
      durationSeconds: parseFloat(durationSeconds),
      throughput: (recordsSynced / parseFloat(durationSeconds)).toFixed(2) + ' orders/sec'
    });

  } catch (error) {
    console.error('❌ Bulk sync error:', error);
    return res.status(500).json({
      error: error.message,
      shop,
      startDate: start,
      endDate: end
    });
  }
}

/**
 * Step 1: Start bulk operation via GraphQL mutation
 */
async function startBulkOperation(shop, shopToken, startDate, endDate) {
  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          orders(query: "created_at:>=${startDate} created_at:<=${endDate}") {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                currentTotalPriceSet { shopMoney { amount currencyCode } }
                originalTotalPriceSet { shopMoney { amount currencyCode } }
                currentSubtotalPriceSet { shopMoney { amount currencyCode } }
                totalDiscountsSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                totalShippingPriceSet { shopMoney { amount currencyCode } }
                shippingAddress { countryCode }
                totalWeight
                refunds {
                  createdAt
                  totalRefundedSet { shopMoney { amount currencyCode } }
                  refundLineItems {
                    edges {
                      node {
                        quantity
                        lineItem { id }
                      }
                    }
                  }
                  transactions(first: 1) {
                    edges {
                      node { processedAt }
                    }
                  }
                }
                lineItems {
                  edges {
                    node {
                      id
                      quantity
                      originalUnitPriceSet { shopMoney { amount } }
                      discountedUnitPriceSet { shopMoney { amount } }
                      totalDiscountSet { shopMoney { amount } }
                      taxLines {
                        edges {
                          node {
                            rate
                            priceSet { shopMoney { amount } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """
      ) {
        bulkOperation {
          id
          status
          url
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopToken
    },
    body: JSON.stringify({ query })
  });

  const result = await response.json();

  // Check for userErrors in mutation response
  if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    const errors = result.data.bulkOperationRunQuery.userErrors;
    throw new Error(`Bulk operation mutation failed: ${errors.map(e => e.message).join(', ')}`);
  }

  // Check for GraphQL errors
  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
  }

  const bulkOp = result.data?.bulkOperationRunQuery?.bulkOperation;
  if (!bulkOp || !bulkOp.id) {
    throw new Error('Bulk operation failed to start - no ID returned');
  }

  return bulkOp.id;
}

/**
 * Step 2: Poll bulk operation status until completion (or timeout)
 */
async function pollBulkOperationStatus(shop, shopToken, bulkOpId) {
  const query = `
    {
      currentBulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  `;

  const startTime = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;

    // Check for timeout (15 minutes max)
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      throw new Error(`Bulk operation timeout after ${POLL_TIMEOUT_MS / 1000}s (attempts: ${attempts})`);
    }

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopToken
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL polling error: ${result.errors.map(e => e.message).join(', ')}`);
    }

    const bulkOp = result.data?.currentBulkOperation;
    if (!bulkOp) {
      throw new Error('No currentBulkOperation found in response');
    }

    // Check if this is our operation
    if (bulkOp.id !== bulkOpId) {
      console.warn(`⚠️ Different bulk operation running: ${bulkOp.id} (expected: ${bulkOpId})`);
    }

    console.log(`🔄 Poll attempt ${attempts}: status=${bulkOp.status}, objectCount=${bulkOp.objectCount || 0}`);

    // Check for errors
    if (bulkOp.errorCode) {
      throw new Error(`Bulk operation failed with error: ${bulkOp.errorCode}`);
    }

    // Check if completed
    if (bulkOp.status === 'COMPLETED') {
      if (!bulkOp.url) {
        throw new Error('Bulk operation completed but no download URL provided');
      }
      return {
        id: bulkOp.id,
        objectCount: bulkOp.objectCount,
        fileSize: bulkOp.fileSize,
        url: bulkOp.url,
        createdAt: bulkOp.createdAt,
        completedAt: bulkOp.completedAt
      };
    }

    // Check for other terminal states
    if (bulkOp.status === 'FAILED' || bulkOp.status === 'CANCELED') {
      throw new Error(`Bulk operation ${bulkOp.status.toLowerCase()}: ${bulkOp.errorCode || 'Unknown error'}`);
    }

    // Sleep before next poll (5 seconds)
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Step 3: Download and parse JSONL file
 */
async function downloadAndParseJSONL(url, shop) {
  console.log(`📥 Downloading JSONL from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download JSONL: ${response.status} ${response.statusText}`);
  }

  const orders = [];
  const stream = Readable.from(response.body);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue; // Skip empty lines

    try {
      const record = JSON.parse(line);

      // Only process Order objects (not nested LineItem/Refund objects)
      if (record.id && record.id.includes('gid://shopify/Order/')) {
        const order = parseOrderRecord(record, shop);
        orders.push(order);
      }
    } catch (parseError) {
      console.error('Failed to parse JSONL line:', parseError.message);
      // Continue processing other lines
    }
  }

  return orders;
}

/**
 * Parse a single Order record from JSONL format
 */
function parseOrderRecord(record, shop) {
  const orderId = record.id.split('/').pop();
  const currency = record.currentTotalPriceSet?.shopMoney?.currencyCode || 'DKK';
  const conversionRate = CURRENCY_RATES[currency] || 1.0;

  // Convert all amounts to DKK
  const currentTotal = parseFloat(record.currentTotalPriceSet?.shopMoney?.amount || 0) * conversionRate;
  const originalTotal = parseFloat(record.originalTotalPriceSet?.shopMoney?.amount || 0) * conversionRate;
  const subtotal = parseFloat(record.currentSubtotalPriceSet?.shopMoney?.amount || 0) * conversionRate;
  const totalDiscounts = parseFloat(record.totalDiscountsSet?.shopMoney?.amount || 0) * conversionRate;
  const totalTax = parseFloat(record.totalTaxSet?.shopMoney?.amount || 0) * conversionRate;
  const totalShipping = parseFloat(record.totalShippingPriceSet?.shopMoney?.amount || 0) * conversionRate;

  // Calculate discounted total (what customer actually paid for products, excluding tax/shipping)
  const discountedTotal = currentTotal - totalTax - totalShipping;

  // Calculate item count (sum of all line item quantities)
  const itemCount = (record.lineItems?.edges || []).reduce((sum, edge) => {
    return sum + (edge.node?.quantity || 0);
  }, 0);

  // Process refunds
  let refundedAmount = 0;
  let refundedQty = 0;
  let refundDate = null;

  if (record.refunds && record.refunds.length > 0) {
    // Sum all refunded amounts
    refundedAmount = record.refunds.reduce((sum, refund) => {
      const amount = parseFloat(refund.totalRefundedSet?.shopMoney?.amount || 0) * conversionRate;
      return sum + amount;
    }, 0);

    // Sum all refunded quantities
    refundedQty = record.refunds.reduce((sum, refund) => {
      const qty = (refund.refundLineItems?.edges || []).reduce((lineSum, edge) => {
        return lineSum + (edge.node?.quantity || 0);
      }, 0);
      return sum + qty;
    }, 0);

    // Get latest refund date (prefer processedAt from transaction, fallback to createdAt)
    const refundDates = record.refunds.map(refund => {
      const processedAt = refund.transactions?.edges?.[0]?.node?.processedAt;
      return processedAt || refund.createdAt;
    });
    refundDate = refundDates.sort().reverse()[0] || null;
  }

  // Calculate sale discount and combined discount
  const saleDiscountTotal = originalTotal - currentTotal;
  const combinedDiscountTotal = totalDiscounts + saleDiscountTotal;

  return {
    shop,
    order_id: orderId,
    created_at: record.createdAt,
    country: record.shippingAddress?.countryCode || 'DK',
    discounted_total: discountedTotal,
    tax: totalTax,
    shipping: totalShipping,
    item_count: itemCount,
    refunded_amount: refundedAmount,
    refunded_qty: refundedQty,
    refund_date: refundDate,
    total_discounts_ex_tax: totalDiscounts,
    cancelled_qty: 0, // Not available in bulk operation output
    sale_discount_total: saleDiscountTotal,
    combined_discount_total: combinedDiscountTotal
  };
}

/**
 * Step 4: Insert orders into Supabase in batches
 */
async function insertOrdersInBatches(orders) {
  let totalInserted = 0;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('orders')
      .upsert(batch, {
        onConflict: 'order_id',
        ignoreDuplicates: false // Update existing records
      });

    if (error) {
      console.error(`❌ Batch insert error (${i}-${i + batch.length}):`, error);
      throw error;
    }

    totalInserted += batch.length;
    console.log(`✅ Inserted batch ${i / BATCH_SIZE + 1}: ${batch.length} orders (total: ${totalInserted})`);
  }

  return totalInserted;
}

/**
 * Get Shopify access token for shop
 */
function getShopToken(shop) {
  const shopMap = {
    'pompdelux-da.myshopify.com': process.env.SHOPIFY_TOKEN_DA,
    'pompdelux-de.myshopify.com': process.env.SHOPIFY_TOKEN_DE,
    'pompdelux-nl.myshopify.com': process.env.SHOPIFY_TOKEN_NL,
    'pompdelux-int.myshopify.com': process.env.SHOPIFY_TOKEN_INT,
    'pompdelux-chf.myshopify.com': process.env.SHOPIFY_TOKEN_CHF
  };
  return shopMap[shop];
}
