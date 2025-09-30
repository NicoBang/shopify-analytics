// api/background-sync.js
const { createClient } = require('@supabase/supabase-js');

class BackgroundSyncer {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async syncInChunks(startDate, endDate, chunkDays = 7) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const chunks = Math.ceil(totalDays / chunkDays);

    // Gem sync status
    const syncId = `sync_${Date.now()}`;
    await this.supabase
      .from('sync_progress')
      .insert({
        sync_id: syncId,
        status: 'in_progress',
        total_chunks: chunks,
        completed_chunks: 0,
        start_date: startDate,
        end_date: endDate,
        created_at: new Date().toISOString()
      });

    let completed = 0;
    const currentChunk = new Date(start);

    while (currentChunk < end) {
      const chunkEnd = new Date(currentChunk);
      chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());

      try {
        // Kald den normale sync API for dette chunk
        const chunkStartStr = currentChunk.toISOString().split('T')[0];
        const chunkEndStr = chunkEnd.toISOString().split('T')[0];

        console.log(`📊 Syncing chunk ${completed + 1}/${chunks}: ${chunkStartStr} to ${chunkEndStr}`);

        // Her ville du kalde din eksisterende sync-shop API
        // const result = await this.callSyncShop(chunkStartStr, chunkEndStr);

        completed++;

        // Opdater progress
        await this.supabase
          .from('sync_progress')
          .update({
            completed_chunks: completed,
            last_chunk_date: chunkEndStr,
            updated_at: new Date().toISOString()
          })
          .eq('sync_id', syncId);

        // Pause mellem chunks for at undgå rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`❌ Error in chunk ${completed + 1}:`, error);

        await this.supabase
          .from('sync_progress')
          .update({
            status: 'error',
            error_message: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('sync_id', syncId);

        throw error;
      }

      currentChunk.setDate(currentChunk.getDate() + chunkDays);
    }

    // Markér som færdig
    await this.supabase
      .from('sync_progress')
      .update({
        status: 'completed',
        completed_chunks: completed,
        updated_at: new Date().toISOString()
      })
      .eq('sync_id', syncId);

    return { syncId, completed, total: chunks };
  }

  async getSyncProgress(syncId) {
    const { data, error } = await this.supabase
      .from('sync_progress')
      .select('*')
      .eq('sync_id', syncId)
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = async function handler(req, res) {
  // CORS og auth som før...

  const { action, syncId, startDate, endDate, chunkDays = 7 } = req.query;

  try {
    const syncer = new BackgroundSyncer();

    switch (action) {
      case 'start':
        if (!startDate || !endDate) {
          return res.status(400).json({ error: 'Missing startDate or endDate' });
        }
        const result = await syncer.syncInChunks(startDate, endDate, parseInt(chunkDays));
        return res.status(200).json({ success: true, ...result });

      case 'progress':
        if (!syncId) {
          return res.status(400).json({ error: 'Missing syncId' });
        }
        const progress = await syncer.getSyncProgress(syncId);
        return res.status(200).json({ success: true, progress });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};