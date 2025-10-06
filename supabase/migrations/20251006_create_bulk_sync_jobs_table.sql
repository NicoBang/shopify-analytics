-- Create bulk_sync_jobs table for tracking Shopify Bulk Operations
-- This table stores progress and status of large data sync operations

CREATE TABLE IF NOT EXISTS bulk_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  object_type TEXT DEFAULT 'orders' CHECK (object_type IN ('orders', 'skus', 'both')),
  status TEXT DEFAULT 'running' CHECK (status IN ('pending', 'running', 'polling', 'downloading', 'processing', 'completed', 'failed')),
  bulk_operation_id TEXT,
  records_processed INTEGER DEFAULT 0,
  orders_synced INTEGER DEFAULT 0,
  skus_synced INTEGER DEFAULT 0,
  file_url TEXT,
  file_size_bytes BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bulk_sync_jobs_status ON bulk_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bulk_sync_jobs_shop ON bulk_sync_jobs(shop);
CREATE INDEX IF NOT EXISTS idx_bulk_sync_jobs_created_at ON bulk_sync_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_sync_jobs_bulk_operation_id ON bulk_sync_jobs(bulk_operation_id);

-- Comments for documentation
COMMENT ON TABLE bulk_sync_jobs IS 'Tracks Shopify Bulk Operations sync jobs for large dataset imports';
COMMENT ON COLUMN bulk_sync_jobs.bulk_operation_id IS 'Shopify Bulk Operation ID (gid://shopify/BulkOperation/...)';
COMMENT ON COLUMN bulk_sync_jobs.status IS 'Current status: pending → running → polling → downloading → processing → completed/failed';
COMMENT ON COLUMN bulk_sync_jobs.object_type IS 'Type of objects being synced: orders, skus, or both';
COMMENT ON COLUMN bulk_sync_jobs.file_size_bytes IS 'Size of JSONL file downloaded from Shopify';
