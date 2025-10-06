-- Add day field to bulk_sync_jobs table for daily batch tracking
-- This enables per-day execution tracking when splitting large date ranges

ALTER TABLE bulk_sync_jobs
ADD COLUMN IF NOT EXISTS day DATE;

-- Index for querying jobs by day
CREATE INDEX IF NOT EXISTS idx_bulk_sync_jobs_day ON bulk_sync_jobs(day);

-- Comment for documentation
COMMENT ON COLUMN bulk_sync_jobs.day IS 'Specific day being processed (ISO date) when using daily batch execution';
