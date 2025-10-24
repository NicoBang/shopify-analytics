-- Backfill September-October 2024
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2024-09-17';
  end_date DATE := '2024-10-31';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling Sept-Oct 2024 (2024-09-17 to 2024-10-31)';

  WHILE processing_date <= end_date LOOP
    -- Color metrics
    PERFORM aggregate_color_metrics_for_date(processing_date);

    -- SKU metrics
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    IF days_processed % 10 = 0 THEN
      RAISE NOTICE '  ✅ Processed % days', days_processed;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ Sept-Oct 2024 complete: % days', days_processed;
END $$;
