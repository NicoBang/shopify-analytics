// api/deduplicate.js
// Remove duplicate SKU records from database
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Validate request
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  const { action = 'check', execute = false } = req.query;

  try {
    if (action === 'check') {
      // Check for duplicates
      console.log('🔍 Checking for duplicate SKU records...');

      // Get sample of duplicates
      const { data: duplicates, error } = await supabase.rpc('check_sku_duplicates');

      if (error) {
        // If function doesn't exist, use direct SQL
        const { data: sampleDuplicates, error: sampleError } = await supabase
          .from('skus')
          .select('shop, order_id, sku, created_at')
          .limit(1000);

        if (sampleError) throw sampleError;

        // Count duplicates manually
        const seen = new Set();
        let duplicateCount = 0;
        const examples = [];

        sampleDuplicates.forEach(row => {
          const key = `${row.shop}-${row.order_id}-${row.sku}`;
          if (seen.has(key)) {
            duplicateCount++;
            if (examples.length < 10) {
              examples.push({
                shop: row.shop,
                order_id: row.order_id,
                sku: row.sku,
                created_at: row.created_at
              });
            }
          }
          seen.add(key);
        });

        return res.status(200).json({
          success: true,
          message: 'Duplicate check complete',
          duplicates: {
            estimated_count: duplicateCount * (221000 / 1000), // Estimate based on sample
            sample_examples: examples
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Duplicate check complete',
        duplicates: duplicates
      });

    } else if (action === 'remove') {
      if (!execute) {
        return res.status(200).json({
          success: false,
          message: 'Set execute=true to actually remove duplicates',
          warning: 'This will permanently delete duplicate records'
        });
      }

      console.log('🧹 Removing duplicate SKU records...');

      // First, get all records to find duplicates
      let allRecords = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error } = await supabase
          .from('skus')
          .select('*')
          .range(offset, offset + batchSize - 1)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (batch && batch.length > 0) {
          allRecords = allRecords.concat(batch);
          offset += batch.length;

          console.log(`📦 Fetched ${allRecords.length} records...`);

          if (batch.length < batchSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`✅ Fetched total ${allRecords.length} records`);

      // Find and remove duplicates
      const seen = new Map();
      const toDelete = [];

      allRecords.forEach(record => {
        const key = `${record.shop}-${record.order_id}-${record.sku}`;

        if (seen.has(key)) {
          // This is a duplicate, mark for deletion
          // Keep the first one (oldest), delete newer ones
          toDelete.push(record.id);
        } else {
          seen.set(key, record);
        }
      });

      console.log(`🗑️ Found ${toDelete.length} duplicates to remove`);

      if (toDelete.length > 0) {
        // Delete in batches
        const deleteChunkSize = 100;
        let deleted = 0;

        for (let i = 0; i < toDelete.length; i += deleteChunkSize) {
          const chunk = toDelete.slice(i, i + deleteChunkSize);

          const { error: deleteError } = await supabase
            .from('skus')
            .delete()
            .in('id', chunk);

          if (deleteError) {
            console.error(`❌ Error deleting batch: ${deleteError.message}`);
          } else {
            deleted += chunk.length;
            console.log(`  Deleted ${deleted}/${toDelete.length} duplicates...`);
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Duplicates removed',
          removed: deleted,
          original_records: allRecords.length,
          unique_records: allRecords.length - deleted
        });
      } else {
        return res.status(200).json({
          success: true,
          message: 'No duplicates found',
          total_records: allRecords.length
        });
      }

    } else if (action === 'stats') {
      // Get statistics before and after deduplication
      const { data: stats, error } = await supabase
        .from('skus')
        .select('shop, created_at', { count: 'exact' });

      if (error) throw error;

      // Get date range stats
      const { data: dateStats, error: dateError } = await supabase
        .rpc('get_sku_date_stats');

      if (dateError) {
        // Fallback to manual calculation
        const { data: sample, error: sampleError } = await supabase
          .from('skus')
          .select('created_at')
          .order('created_at', { ascending: true })
          .limit(1);

        const { data: sampleLast, error: sampleLastError } = await supabase
          .from('skus')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1);

        return res.status(200).json({
          success: true,
          stats: {
            total_records: stats?.length || 0,
            date_range: {
              earliest: sample?.[0]?.created_at,
              latest: sampleLast?.[0]?.created_at
            }
          }
        });
      }

      return res.status(200).json({
        success: true,
        stats: {
          total_records: stats?.length || 0,
          date_stats: dateStats
        }
      });
    }

    return res.status(400).json({
      error: 'Invalid action. Use: check, remove, or stats'
    });

  } catch (error) {
    console.error('💥 Deduplication error:', error);
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};