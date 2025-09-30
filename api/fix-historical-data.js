// api/fix-historical-data.js
const { createClient } = require('@supabase/supabase-js');

class HistoricalDataFixer {
  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase URL and Service Key are required');
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async fixOrderAggregates(batchSize = 50, offset = 0) {
    console.log(`🔧 Fixing order aggregates: batch ${batchSize}, offset ${offset}`);

    // Hent ordrer med refunds/cancellations i batches
    const { data: orders, error: orderError } = await this.supabase
      .from('orders')
      .select('order_id, refunded_qty, cancelled_qty, refund_date')
      .not('refund_date', 'is', null)
      .range(offset, offset + batchSize - 1)
      .order('order_id');

    if (orderError) {
      console.error('❌ Error fetching orders:', orderError);
      throw orderError;
    }

    if (!orders || orders.length === 0) {
      return { fixed: 0, hasMore: false };
    }

    const fixes = [];

    // For hver ordre, beregn korrekte aggregater fra SKUs
    for (const order of orders) {
      const { data: skus, error: skuError } = await this.supabase
        .from('skus')
        .select('refunded_qty, cancelled_qty')
        .eq('order_id', order.order_id);

      if (skuError) {
        console.warn(`⚠️ Error fetching SKUs for order ${order.order_id}:`, skuError);
        continue;
      }

      const correctRefunded = skus.reduce((sum, sku) => sum + (sku.refunded_qty || 0), 0);
      const correctCancelled = skus.reduce((sum, sku) => sum + (sku.cancelled_qty || 0), 0);

      // Kun ret hvis der er forskel
      if (order.refunded_qty !== correctRefunded || order.cancelled_qty !== correctCancelled) {
        fixes.push({
          order_id: order.order_id,
          old_refunded: order.refunded_qty,
          old_cancelled: order.cancelled_qty,
          new_refunded: correctRefunded,
          new_cancelled: correctCancelled
        });

        // Opdater orden
        const { error: updateError } = await this.supabase
          .from('orders')
          .update({
            refunded_qty: correctRefunded,
            cancelled_qty: correctCancelled,
            updated_at: new Date().toISOString()
          })
          .eq('order_id', order.order_id);

        if (updateError) {
          console.error(`❌ Error updating order ${order.order_id}:`, updateError);
        }
      }
    }

    console.log(`✅ Fixed ${fixes.length} orders out of ${orders.length} checked`);
    return {
      fixed: fixes.length,
      checked: orders.length,
      hasMore: orders.length === batchSize,
      fixes: fixes.slice(0, 10) // Vis kun første 10 fixes
    };
  }
}

// Enable CORS
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

  const { batchSize = 50, offset = 0 } = req.query;

  try {
    const fixer = new HistoricalDataFixer();
    const result = await fixer.fixOrderAggregates(
      parseInt(batchSize),
      parseInt(offset)
    );

    return res.status(200).json({
      success: true,
      ...result,
      nextOffset: result.hasMore ? parseInt(offset) + parseInt(batchSize) : null,
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