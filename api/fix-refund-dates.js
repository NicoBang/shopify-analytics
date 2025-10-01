// api/fix-refund-dates.js
// Fix refund_date inconsistency between orders and skus tables
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

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  const { batchSize = 100, offset = 0, dryRun = 'false' } = req.query;
  const isDryRun = dryRun === 'true';

  console.log(`🔧 Starting refund_date fix (${isDryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log(`📊 Batch size: ${batchSize}, Offset: ${offset}`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Step 1: Find orders with refunds
    const { data: ordersWithRefunds, error: ordersError } = await supabase
      .from('orders')
      .select('shop, order_id, refund_date')
      .not('refund_date', 'is', null)
      .range(offset, offset + parseInt(batchSize) - 1);

    if (ordersError) throw ordersError;

    console.log(`📦 Found ${ordersWithRefunds.length} orders with refunds`);

    // Step 2: For each order, get correct refund_date from skus
    const updates = [];
    const mismatches = [];

    for (const order of ordersWithRefunds) {
      const { data: skus, error: skusError } = await supabase
        .from('skus')
        .select('refund_date')
        .eq('shop', order.shop)
        .eq('order_id', order.order_id)
        .not('refund_date', 'is', null)
        .order('refund_date', { ascending: true })
        .limit(1);

      if (skusError) {
        console.warn(`⚠️ Error fetching SKUs for order ${order.order_id}:`, skusError.message);
        continue;
      }

      if (!skus || skus.length === 0) {
        console.warn(`⚠️ No SKUs with refund_date for order ${order.order_id}`);
        continue;
      }

      const correctRefundDate = skus[0].refund_date;

      // Compare dates
      if (order.refund_date !== correctRefundDate) {
        mismatches.push({
          shop: order.shop,
          order_id: order.order_id,
          old_refund_date: order.refund_date,
          correct_refund_date: correctRefundDate
        });

        if (!isDryRun) {
          updates.push({
            shop: order.shop,
            order_id: order.order_id,
            refund_date: correctRefundDate
          });
        }
      }
    }

    console.log(`🔍 Found ${mismatches.length} mismatches`);

    // Step 3: Update orders table (if not dry run)
    let updateCount = 0;
    if (!isDryRun && updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            refund_date: update.refund_date,
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
      ordersChecked: ordersWithRefunds.length,
      mismatchesFound: mismatches.length,
      ordersUpdated: updateCount,
      mismatches: mismatches.slice(0, 10), // Return first 10 as sample
      hasMore: ordersWithRefunds.length === parseInt(batchSize),
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
