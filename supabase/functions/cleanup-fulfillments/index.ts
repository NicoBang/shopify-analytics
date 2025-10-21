// Cleanup duplicate fulfillments - keep only the oldest occurrence
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FulfillmentRecord {
  id: string;
  order_id: string;
  date: string;
  country: string;
  carrier: string;
  item_count: number;
  created_at: string;
  shop: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🧹 Starting cleanup of duplicate fulfillments...');

    // Get ALL fulfillments using pagination
    let allFulfillments: FulfillmentRecord[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error: fetchError } = await supabase
        .from('fulfillments')
        .select('id, order_id, date, country, carrier, item_count, created_at, shop')
        .order('created_at', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        console.error('❌ Error fetching fulfillments:', fetchError);
        throw fetchError;
      }

      if (batch && batch.length > 0) {
        allFulfillments = allFulfillments.concat(batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Fetched ${allFulfillments.length} total fulfillments`);

    // Group by composite key and find duplicates
    const groups = new Map<string, FulfillmentRecord[]>();
    const duplicateIds: string[] = [];

    allFulfillments.forEach(fulfillment => {
      const key = `${fulfillment.order_id}|${fulfillment.date}|${fulfillment.country}|${fulfillment.carrier}|${fulfillment.item_count}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(fulfillment);
    });

    // Find duplicates (keep the first/oldest, mark others for deletion)
    let duplicatesFound = 0;
    groups.forEach((fulfillments, key) => {
      if (fulfillments.length > 1) {
        // Sort by created_at to keep the oldest
        fulfillments.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        // Mark all but the first for deletion
        for (let i = 1; i < fulfillments.length; i++) {
          duplicateIds.push(fulfillments[i].id);
          duplicatesFound++;
        }
      }
    });

    if (duplicatesFound === 0) {
      console.log('✅ No duplicates found');
      return new Response(
        JSON.stringify({
          success: true,
          totalFulfillments: allFulfillments.length,
          duplicatesFound: 0,
          duplicatesRemoved: 0,
          uniqueFulfillments: allFulfillments.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🗑️ Found ${duplicatesFound} duplicates to remove`);

    // Remove duplicates in batches
    let removedCount = 0;
    const deleteBatchSize = 1000;

    for (let i = 0; i < duplicateIds.length; i += deleteBatchSize) {
      const batch = duplicateIds.slice(i, i + deleteBatchSize);

      const { error: deleteError } = await supabase
        .from('fulfillments')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error('❌ Error deleting duplicates:', deleteError);
        throw deleteError;
      }

      removedCount += batch.length;
      console.log(`🗑️ Deleted batch ${i / deleteBatchSize + 1}: ${batch.length} records`);
    }

    console.log(`✅ Cleanup completed: ${removedCount} duplicates removed`);

    return new Response(
      JSON.stringify({
        success: true,
        totalFulfillments: allFulfillments.length,
        duplicatesFound: duplicatesFound,
        duplicatesRemoved: removedCount,
        uniqueFulfillments: allFulfillments.length - removedCount,
        cleanupSuccess: true
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('💥 Error during cleanup:', error);
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
