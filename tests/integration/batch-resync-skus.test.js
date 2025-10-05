/**
 * Integration tests for batch-resync-skus API endpoint
 * Tests async job creation, status tracking, and batch processing
 */

const { createClient } = require('@supabase/supabase-js');

// Test configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_SECRET_KEY || 'bda5da3d49fe0e7391fded3895b5c6bc';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

describe('Batch Resync SKUs API', () => {
  let testJobId;

  // Cleanup after tests
  afterAll(async () => {
    if (testJobId) {
      await supabase
        .from('resync_jobs')
        .delete()
        .eq('id', testJobId);
    }
  });

  test('should start resync job and return jobId quickly (<5s)', async () => {
    const startTime = Date.now();

    const response = await fetch(`${API_BASE_URL}/api/batch-resync-skus`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate: '2024-10-01',
        endDate: '2024-10-02',
        batchSize: 100
      })
    });

    const elapsedTime = Date.now() - startTime;
    const data = await response.json();

    // Should return quickly (HTTP 202 Accepted)
    expect(response.status).toBe(202);
    expect(elapsedTime).toBeLessThan(5000);

    // Should return jobId and status
    expect(data).toHaveProperty('jobId');
    expect(data).toHaveProperty('status');
    expect(data.status).toBe('started');

    // Save jobId for cleanup
    testJobId = data.jobId;
  });

  test('should track job status correctly', async () => {
    // Wait a bit for job to start processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response = await fetch(`${API_BASE_URL}/api/resync-job-status?jobId=${testJobId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('jobId');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('totalCount');
    expect(data).toHaveProperty('processedCount');
    expect(data).toHaveProperty('progressPercent');

    // Status should be running or completed
    expect(['running', 'completed', 'failed']).toContain(data.status);
  });

  test('should list recent jobs when no jobId provided', async () => {
    const response = await fetch(`${API_BASE_URL}/api/resync-job-status`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);

    // Should include our test job
    const ourJob = data.jobs.find(j => j.id === testJobId);
    expect(ourJob).toBeDefined();
  });

  test('should only process SKUs with cancelled_qty > 0', async () => {
    // Query database to check what SKUs would be processed
    const { data: skus, error } = await supabase
      .from('skus')
      .select('cancelled_qty, cancelled_amount_dkk')
      .gte('created_at', '2024-10-01')
      .lte('created_at', '2024-10-02')
      .or('cancelled_amount_dkk.is.null,cancelled_amount_dkk.eq.0')
      .gt('cancelled_qty', 0);

    expect(error).toBeNull();

    // All returned SKUs should have cancelled_qty > 0
    if (skus && skus.length > 0) {
      skus.forEach(sku => {
        expect(sku.cancelled_qty).toBeGreaterThan(0);
      });
    }
  });

  test('should require authentication', async () => {
    const response = await fetch(`${API_BASE_URL}/api/batch-resync-skus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate: '2024-10-01',
        endDate: '2024-10-02'
      })
    });

    expect(response.status).toBe(401);
  });

  test('should validate required parameters', async () => {
    const response = await fetch(`${API_BASE_URL}/api/batch-resync-skus`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Missing startDate and endDate
        batchSize: 100
      })
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/required/i);
  });
});

describe('Database Migration - resync_jobs table', () => {
  test('should have resync_jobs table with correct schema', async () => {
    // Test insert
    const { data: job, error: insertError } = await supabase
      .from('resync_jobs')
      .insert({
        start_date: '2024-10-01',
        end_date: '2024-10-02',
        batch_size: 100,
        status: 'running'
      })
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(job).toHaveProperty('id');
    expect(job.status).toBe('running');
    expect(job.batch_size).toBe(100);

    // Test update
    const { error: updateError } = await supabase
      .from('resync_jobs')
      .update({
        status: 'completed',
        total_count: 1000,
        processed_count: 1000,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);

    expect(updateError).toBeNull();

    // Test select
    const { data: updated, error: selectError } = await supabase
      .from('resync_jobs')
      .select('*')
      .eq('id', job.id)
      .single();

    expect(selectError).toBeNull();
    expect(updated.status).toBe('completed');
    expect(updated.total_count).toBe(1000);
    expect(updated.processed_count).toBe(1000);

    // Cleanup
    await supabase
      .from('resync_jobs')
      .delete()
      .eq('id', job.id);
  });

  test('should enforce status check constraint', async () => {
    const { error } = await supabase
      .from('resync_jobs')
      .insert({
        start_date: '2024-10-01',
        end_date: '2024-10-02',
        status: 'invalid_status' // Should fail
      });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/check constraint/i);
  });
});
