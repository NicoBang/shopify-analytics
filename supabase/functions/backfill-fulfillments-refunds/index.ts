// Backfill refund data from SKUs table into fulfillments table
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 Starting backfill of fulfillments refund data from SKUs...');

    // Get all fulfillments
    let allFulfillments = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('fulfillments')
        .select('id, order_id')
        .range(offset, offset + batchSize - 1);

      if (error) throw error;

      if (batch && batch.length > 0) {
        allFulfillments = allFulfillments.concat(batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Found ${allFulfillments.length} fulfillments to process`);

    // Process in batches
    let updatedCount = 0;
    let skippedCount = 0;
    const processBatchSize = 100;

    for (let i = 0; i < allFulfillments.length; i += processBatchSize) {
      const batch = allFulfillments.slice(i, i + processBatchSize);
      const orderIds = batch.map(f => f.order_id);

      // Get refund data from SKUs for these orders
      const { data: skuData, error: skuError } = await supabase
        .from('skus')
        .select('order_id, refunded_qty, refund_date')
        .in('order_id', orderIds)
        .not('refund_date', 'is', null);

      if (skuError) throw skuError;

      // Aggregate by order_id
      const refundsByOrder = new Map();

      skuData?.forEach(sku => {
        if (!refundsByOrder.has(sku.order_id)) {
          refundsByOrder.set(sku.order_id, {
            refunded_qty: 0,
            refund_date: null
          });
        }

        const current = refundsByOrder.get(sku.order_id);
        current.refunded_qty += Number(sku.refunded_qty) || 0;

        // Keep latest refund_date
        if (sku.refund_date) {
          if (!current.refund_date || new Date(sku.refund_date) > new Date(current.refund_date)) {
            current.refund_date = sku.refund_date;
          }
        }
      });

      // Update fulfillments
      for (const fulfillment of batch) {
        const refundData = refundsByOrder.get(fulfillment.order_id);

        if (refundData && refundData.refunded_qty > 0) {
          const { error: updateError } = await supabase
            .from('fulfillments')
            .update({
              refunded_qty: refundData.refunded_qty,
              refund_date: refundData.refund_date
            })
            .eq('id', fulfillment.id);

          if (updateError) {
            console.error(`❌ Error updating fulfillment ${fulfillment.id}:`, updateError);
          } else {
            updatedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      console.log(`📊 Progress: ${i + batch.length}/${allFulfillments.length} (${updatedCount} updated, ${skippedCount} skipped)`);
    }

    console.log(`✅ Backfill completed: ${updatedCount} fulfillments updated with refund data`);

    return new Response(
      JSON.stringify({
        success: true,
        totalFulfillments: allFulfillments.length,
        updatedCount,
        skippedCount,
        message: `Updated ${updatedCount} fulfillments with refund data from SKUs`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('💥 Error during backfill:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
