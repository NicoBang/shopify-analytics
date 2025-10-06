-- Create bulk_job_logs table for orchestrator logging
CREATE TABLE IF NOT EXISTS bulk_job_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for querying by shop and date
CREATE INDEX IF NOT EXISTS idx_bulk_job_logs_shop_date
  ON bulk_job_logs(shop, start_date, end_date);

-- Create index for querying by status
CREATE INDEX IF NOT EXISTS idx_bulk_job_logs_status
  ON bulk_job_logs(status);

-- Add comment
COMMENT ON TABLE bulk_job_logs IS 'Log table for bulk sync orchestrator jobs';
