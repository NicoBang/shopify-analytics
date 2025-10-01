// api/fix-historical-vat.js
// Fix historical orders that have VAT-inclusive price_dkk instead of VAT-exclusive
const { createClient } = require('@supabase/supabase-js');

function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

// Currency conversion rates (same as sync-shop.js)
const CURRENCY_RATES = {
  'pompdelux-da.myshopify.com': 1.0,    // DKK (base)
  'pompdelux-de.myshopify.com': 7.46,   // EUR → DKK
  'pompdelux-nl.myshopify.com': 7.46,   // EUR → DKK
  'pompdelux-int.myshopify.com': 7.46,  // EUR → DKK
  'pompdelux-chf.myshopify.com': 6.84   // CHF → DKK
};

// Fetch order from Shopify GraphQL and recalculate price_dkk
async function recalculateOrderFromShopify(shop, orderId, shopifyToken) {
  const orderGraphId = `gid://shopify/Order/${orderId}`;

  const query = `
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        name
        createdAt
        taxesIncluded
        shippingAddress {
          countryCode
        }
        lineItems(first: 100) {
          nodes {
            id
            name
            sku
            quantity
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            taxLines {
              priceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopifyToken
    },
    body: JSON.stringify({
      query,
      variables: { id: orderGraphId }
    })
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  const order = result.data?.order;
  if (!order) {
    throw new Error(`Order ${orderId} not found in Shopify`);
  }

  // Calculate total discounted price in DKK (VAT-exclusive)
  const conversionRate = CURRENCY_RATES[shop];
  const taxesIncluded = order.taxesIncluded;
  let totalDkkExVat = 0;

  for (const lineItem of order.lineItems.nodes) {
    const quantity = lineItem.quantity;
    const unitPrice = parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount);

    // Calculate line tax
    let lineTax = 0;
    if (lineItem.taxLines) {
      for (const taxLine of lineItem.taxLines) {
        lineTax += parseFloat(taxLine.priceSet.shopMoney.amount);
      }
    }

    // Calculate unit price EX VAT
    let unitPriceExVat;
    if (taxesIncluded) {
      // Prices include tax - subtract tax to get EX VAT
      unitPriceExVat = unitPrice - (lineTax / quantity);
    } else {
      // Prices exclude tax - use directly
      unitPriceExVat = unitPrice;
    }

    // Convert to DKK and add to total
    const lineTotalDkkExVat = unitPriceExVat * quantity * conversionRate;
    totalDkkExVat += lineTotalDkkExVat;
  }

  return {
    orderId,
    shop,
    correctPriceDkk: Math.round(totalDkkExVat * 100) / 100,
    taxesIncluded
  };
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  const { batchSize = 100, offset = 0, dryRun = 'false', shop: targetShop = null } = req.query;
  const isDryRun = dryRun === 'true';

  console.log(`🔧 Starting VAT fix (${isDryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log(`📊 Batch size: ${batchSize}, Offset: ${offset}`);
  if (targetShop) console.log(`🏪 Target shop: ${targetShop}`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Step 1: Get batch of orders to fix
    let query = supabase
      .from('orders')
      .select('shop, order_id, discounted_total, raw_data')
      .range(offset, offset + parseInt(batchSize) - 1);

    if (targetShop) {
      query = query.eq('shop', targetShop);
    }

    const { data: orders, error: ordersError } = await query;

    if (ordersError) throw ordersError;

    console.log(`📦 Found ${orders.length} orders to process`);

    // Step 2: Re-calculate price_dkk for each order
    const updates = [];
    const corrections = [];
    let processed = 0;
    let corrected = 0;

    for (const order of orders) {
      processed++;

      try {
        // Get Shopify token for this shop
        const tokenKey = order.shop.replace('pompdelux-', '').replace('.myshopify.com', '').toUpperCase();
        const shopifyToken = process.env[`SHOPIFY_TOKEN_${tokenKey}`];

        if (!shopifyToken) {
          console.warn(`⚠️ No token found for shop ${order.shop}`);
          continue;
        }

        // Recalculate from Shopify
        const result = await recalculateOrderFromShopify(order.shop, order.order_id, shopifyToken);

        // Check if price differs
        const currentPrice = order.discounted_total;
        const correctPrice = result.correctPriceDkk;
        const difference = Math.abs(currentPrice - correctPrice);

        if (difference > 0.01) { // More than 1 øre difference
          corrected++;
          corrections.push({
            shop: order.shop,
            order_id: order.order_id,
            old_price_dkk: currentPrice,
            correct_price_dkk: correctPrice,
            difference: Math.round((currentPrice - correctPrice) * 100) / 100,
            taxes_included: result.taxesIncluded
          });

          if (!isDryRun) {
            updates.push({
              shop: order.shop,
              order_id: order.order_id,
              discounted_total: correctPrice
            });
          }
        }

        // Rate limiting - wait a bit between Shopify requests
        if (processed % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`❌ Failed to process order ${order.order_id}:`, error.message);
      }
    }

    console.log(`🔍 Processed ${processed} orders, found ${corrected} with incorrect VAT`);

    // Step 3: Update orders table (if not dry run)
    let updateCount = 0;
    if (!isDryRun && updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            discounted_total: update.discounted_total,
            updated_at: new Date().toISOString()
          })
          .eq('shop', update.shop)
          .eq('order_id', update.order_id);

        if (updateError) {
          console.error(`❌ Failed to update ${update.order_id}:`, updateError.message);
        } else {
          updateCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: isDryRun,
      ordersProcessed: processed,
      correctionsNeeded: corrected,
      ordersUpdated: updateCount,
      corrections: corrections.slice(0, 10), // Return first 10 as sample
      hasMore: orders.length === parseInt(batchSize),
      nextOffset: offset + parseInt(batchSize),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Fix error:', error);

    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
