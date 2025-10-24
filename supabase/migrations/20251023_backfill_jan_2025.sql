-- Backfill January 2025
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2025-01-01';
  end_date DATE := '2025-01-31';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling January 2025';

  WHILE processing_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(processing_date);
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    IF days_processed % 10 = 0 THEN
      RAISE NOTICE '  ✅ Processed % days', days_processed;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ January 2025 complete: % days', days_processed;
END $$;
