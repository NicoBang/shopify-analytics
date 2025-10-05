// api/resync-job-status.js
// Check status of batch resync jobs

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check API key
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.API_SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get job ID from query params
  const { jobId } = req.query;

  if (!jobId) {
    // List all jobs if no jobId provided
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: jobs, error } = await supabase
      .from('resync_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ jobs });
  }

  // Get specific job status
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: job, error } = await supabase
    .from('resync_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Calculate progress percentage
  const progressPercent = job.total_count > 0
    ? Math.round((job.processed_count / job.total_count) * 100)
    : 0;

  return res.status(200).json({
    jobId: job.id,
    status: job.status,
    startDate: job.start_date,
    endDate: job.end_date,
    batchSize: job.batch_size,
    totalCount: job.total_count,
    processedCount: job.processed_count,
    progressPercent: progressPercent,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    completedAt: job.completed_at
  });
};
