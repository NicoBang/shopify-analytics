-- Add missing cancelled_amount column to daily_color_metrics
-- Date: 2025-10-23
-- This column is needed for the aggregate_color_metrics_for_date function

ALTER TABLE daily_color_metrics
ADD COLUMN IF NOT EXISTS cancelled_amount NUMERIC(10,2) DEFAULT 0;

-- Add comment
COMMENT ON COLUMN daily_color_metrics.cancelled_amount IS 'Total cancelled amount in DKK (EX VAT) for this artikelnummer on this date';

-- Backfill cancelled_amount from existing data
WITH cancelled_data AS (
  SELECT
    (created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
    (regexp_match(sku, '^(\d+)'))[1] AS artikelnummer,
    SUM(COALESCE(cancelled_amount_dkk, 0))::numeric(10,2) AS cancelled_amount
  FROM skus
  WHERE cancelled_qty > 0
    AND (regexp_match(sku, '^(\d+)'))[1] IS NOT NULL
  GROUP BY metric_date, artikelnummer
)
UPDATE daily_color_metrics dcm
SET cancelled_amount = cd.cancelled_amount,
    updated_at = NOW()
FROM cancelled_data cd
WHERE dcm.metric_date = cd.metric_date
  AND dcm.artikelnummer = cd.artikelnummer
  AND cd.cancelled_amount > 0;

-- Verify
SELECT
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE cancelled_amount > 0) as rows_with_cancelled_amount,
  SUM(cancelled_amount) as total_cancelled_amount
FROM daily_color_metrics;
