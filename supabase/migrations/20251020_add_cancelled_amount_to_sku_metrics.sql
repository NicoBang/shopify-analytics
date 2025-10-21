-- Add cancelled_amount column to daily_sku_metrics table
-- This column stores the DKK amount of cancelled items (quantity * cancelled_amount_dkk)
-- Migration backfill script expects this column to exist!

ALTER TABLE daily_sku_metrics
ADD COLUMN IF NOT EXISTS cancelled_amount NUMERIC(10,2) DEFAULT 0;

-- Add comment
COMMENT ON COLUMN daily_sku_metrics.cancelled_amount IS 'Total cancelled amount in DKK (stored separately, already deducted from omsaetning_net)';

-- Add index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_daily_sku_metrics_cancelled ON daily_sku_metrics(cancelled_amount) WHERE cancelled_amount > 0;
