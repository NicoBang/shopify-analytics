-- Add missing cancelled_amount column to daily_sku_metrics
-- Date: 2025-10-23
-- This column is needed for the aggregate_sku_metrics_for_date function

ALTER TABLE daily_sku_metrics
ADD COLUMN IF NOT EXISTS cancelled_amount NUMERIC(10,2) DEFAULT 0;

-- Add comment
COMMENT ON COLUMN daily_sku_metrics.cancelled_amount IS 'Total cancelled amount in DKK (EX VAT) for this SKU on this date';

-- Backfill cancelled_amount from existing data
WITH cancelled_data AS (
  SELECT
    (created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
    sku,
    SUM(COALESCE(cancelled_amount_dkk, 0))::numeric(10,2) AS cancelled_amount
  FROM skus
  WHERE cancelled_qty > 0
    AND (regexp_match(sku, '^(\d+)'))[1] IS NOT NULL
  GROUP BY metric_date, sku
)
UPDATE daily_sku_metrics dsm
SET cancelled_amount = cd.cancelled_amount,
    updated_at = NOW()
FROM cancelled_data cd
WHERE dsm.metric_date = cd.metric_date
  AND dsm.sku = cd.sku
  AND cd.cancelled_amount > 0;

-- Verify
SELECT
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE cancelled_amount > 0) as rows_with_cancelled_amount,
  SUM(cancelled_amount) as total_cancelled_amount
FROM daily_sku_metrics;
