-- Create resync_jobs table for tracking async SKU resync operations
-- Migration: 2025-10-05 - Track batch resync jobs to avoid timeout issues

-- Problem: Re-syncing historical SKU data via API times out on Vercel (60s limit)
-- Solution: Async batch processing with job tracking in database

CREATE TABLE IF NOT EXISTS resync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  batch_size INTEGER DEFAULT 500,
  total_count INTEGER DEFAULT 0,
  processed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for efficient status queries
CREATE INDEX IF NOT EXISTS idx_resync_jobs_status ON resync_jobs(status);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_resync_jobs_dates ON resync_jobs(start_date, end_date);

COMMENT ON TABLE resync_jobs IS 'Tracks async batch resync operations for SKU data';
COMMENT ON COLUMN resync_jobs.start_date IS 'Start of date range to resync (inclusive)';
COMMENT ON COLUMN resync_jobs.end_date IS 'End of date range to resync (inclusive)';
COMMENT ON COLUMN resync_jobs.batch_size IS 'Number of SKUs to process per batch';
COMMENT ON COLUMN resync_jobs.total_count IS 'Total number of SKUs to process';
COMMENT ON COLUMN resync_jobs.processed_count IS 'Number of SKUs processed so far';
COMMENT ON COLUMN resync_jobs.status IS 'Job status: running, completed, or failed';

-- Rollback script:
-- DROP TABLE IF EXISTS resync_jobs CASCADE;
