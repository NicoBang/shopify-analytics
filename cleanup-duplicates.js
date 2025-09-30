// Standalone cleanup script for fulfillment duplicates
const { createClient } = require('@supabase/supabase-js');

async function cleanupDuplicates() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log('🧹 Starting fulfillment duplicates cleanup...');

  try {
    // Count total before cleanup
    const { count: totalBefore, error: countError } = await supabase
      .from('fulfillments')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw countError;
    }

    console.log(`📊 Total fulfillments before cleanup: ${totalBefore}`);

    // Find duplicates using a window function approach
    const { data: duplicates, error: duplicateError } = await supabase.rpc('get_duplicate_fulfillments', {
      sql: `
        SELECT id, order_id, date, country, carrier, item_count, created_at,
        ROW_NUMBER() OVER (PARTITION BY order_id, date, country, carrier, item_count ORDER BY created_at) as row_num
        FROM fulfillments
      `
    });

    if (duplicateError) {
      console.log('⚠️ RPC not available, using JavaScript approach...');

      // Fallback: Get all fulfillments and process in JavaScript
      let allFulfillments = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        console.log(`📦 Fetching batch: offset=${offset}`);

        const { data: batch, error: fetchError } = await supabase
          .from('fulfillments')
          .select('id, order_id, date, country, carrier, item_count, created_at')
          .order('created_at')
          .range(offset, offset + batchSize - 1);

        if (fetchError) throw fetchError;

        if (batch && batch.length > 0) {
          allFulfillments = allFulfillments.concat(batch);
          hasMore = batch.length === batchSize;
          offset += batchSize;
          console.log(`Total loaded: ${allFulfillments.length}`);
        } else {
          hasMore = false;
        }
      }

      console.log(`📊 Analyzing ${allFulfillments.length} fulfillments for duplicates...`);

      // Group by composite key
      const groups = new Map();
      allFulfillments.forEach(f => {
        const key = `${f.order_id}|${f.date}|${f.country}|${f.carrier}|${f.item_count}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(f);
      });

      // Find duplicates (keep first, delete rest)
      const toDelete = [];
      groups.forEach(fulfillments => {
        if (fulfillments.length > 1) {
          // Sort by created_at, keep first
          fulfillments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          for (let i = 1; i < fulfillments.length; i++) {
            toDelete.push(fulfillments[i].id);
          }
        }
      });

      console.log(`🗑️ Found ${toDelete.length} duplicates to remove`);

      if (toDelete.length > 0) {
        // Delete in batches
        const deleteBatchSize = 1000;
        let deleted = 0;

        for (let i = 0; i < toDelete.length; i += deleteBatchSize) {
          const batch = toDelete.slice(i, i + deleteBatchSize);

          const { error: deleteError } = await supabase
            .from('fulfillments')
            .delete()
            .in('id', batch);

          if (deleteError) throw deleteError;

          deleted += batch.length;
          console.log(`✅ Deleted batch: ${deleted}/${toDelete.length}`);
        }

        console.log(`🎯 Cleanup completed: ${deleted} duplicates removed`);
      } else {
        console.log('✅ No duplicates found!');
      }

      // Count total after cleanup
      const { count: totalAfter, error: countAfterError } = await supabase
        .from('fulfillments')
        .select('*', { count: 'exact', head: true });

      if (countAfterError) {
        throw countAfterError;
      }

      console.log(`📊 Total fulfillments after cleanup: ${totalAfter}`);
      console.log(`📈 Removed: ${totalBefore - totalAfter} duplicates`);

      return {
        totalBefore,
        totalAfter,
        duplicatesRemoved: totalBefore - totalAfter
      };
    }

  } catch (error) {
    console.error('💥 Cleanup error:', error);
    throw error;
  }
}

module.exports = { cleanupDuplicates };

// If run directly
if (require.main === module) {
  cleanupDuplicates()
    .then(result => {
      console.log('🎯 Final result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}