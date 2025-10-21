-- Add cancelled_amount column to daily_color_metrics table
ALTER TABLE daily_color_metrics
ADD COLUMN IF NOT EXISTS cancelled_amount NUMERIC(10,2) DEFAULT 0;

-- Add comment
COMMENT ON COLUMN daily_color_metrics.cancelled_amount IS 'Total cancelled amount in DKK (stored separately, already deducted from omsaetning_net)';
