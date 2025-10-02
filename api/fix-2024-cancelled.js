// API endpoint to fix 2024 cancelled_qty data
import { createClient } from '@supabase/supabase-js';

export const config = {
  maxDuration: 60, // 60 seconds for Edge Function
};

export default async function handler(req, res) {
  // Auth check
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.API_SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    console.log('🔧 Starting 2024 cancelled_qty fix...');

    // Step 1: Get ALL orders (ignore dates - just match by order_id later)
    // We'll use the orders from the raw analytics data we already have
    const { data: allOrders, error: ordersError } = await supabase
      .from('orders')
      .select('order_id, cancelled_qty, item_count, created_at')
      .gt('cancelled_qty', 0)
      .order('created_at', { ascending: false })
      .limit(1000); // Get up to 1000 orders with cancellations

    // Filter to 2024-09-30 to 2024-10-06 in JavaScript (more reliable than Supabase timestamp filter)
    const ordersWithCancelled = (allOrders || []).filter(o => {
      const date = o.created_at.substring(0, 10); // Get YYYY-MM-DD
      return date >= '2024-09-30' && date <= '2024-10-06';
    });

    if (ordersError) throw ordersError;

    console.log(`📊 Found ${ordersWithCancelled?.length || 0} orders with cancelled items`);

    if (!ordersWithCancelled || ordersWithCancelled.length === 0) {
      return res.json({
        success: true,
        message: 'No orders with cancelled items found',
        ordersProcessed: 0,
        skusUpdated: 0
      });
    }

    // Step 2: For each order, get its SKUs and update cancelled_qty
    let totalSkusUpdated = 0;

    for (const order of ordersWithCancelled) {
      // Get all SKUs for this order (using order_id directly, no date filter needed)
      const { data: orderSkus, error: skusError } = await supabase
        .from('skus')
        .select('id, order_id, quantity')
        .eq('order_id', order.order_id);

      if (skusError) {
        console.error(`Error fetching SKUs for order ${order.order_id}:`, skusError);
        continue;
      }

      if (!orderSkus || orderSkus.length === 0) continue;

      // Calculate proportional cancelled_qty for each SKU
      const orderItemCount = order.item_count;
      const orderCancelledQty = order.cancelled_qty;

      for (const sku of orderSkus) {
        const skuCancelledQty = Math.round(
          (sku.quantity / orderItemCount) * orderCancelledQty
        );

        // Update the SKU with calculated cancelled_qty
        const { error: updateError } = await supabase
          .from('skus')
          .update({ cancelled_qty: skuCancelledQty })
          .eq('id', sku.id);

        if (updateError) {
          console.error(`Error updating SKU ${sku.id}:`, updateError);
        } else {
          totalSkusUpdated++;
        }
      }
    }

    console.log(`✅ Updated ${totalSkusUpdated} SKUs with cancelled_qty`);

    // Step 3: Verify results
    const { data: verifyData, error: verifyError } = await supabase
      .from('skus')
      .select('cancelled_qty')
      .gte('created_at', '2024-09-30T00:00:00Z')
      .lte('created_at', '2024-10-06T23:59:59Z')
      .gt('cancelled_qty', 0);

    const totalCancelled = verifyData?.reduce((sum, row) => sum + (row.cancelled_qty || 0), 0) || 0;

    return res.json({
      success: true,
      message: 'Successfully fixed 2024 cancelled_qty data',
      ordersProcessed: ordersWithCancelled.length,
      skusUpdated: totalSkusUpdated,
      verification: {
        skusWithCancelled: verifyData?.length || 0,
        totalCancelledQty: totalCancelled
      }
    });

  } catch (error) {
    console.error('❌ Error fixing 2024 data:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
