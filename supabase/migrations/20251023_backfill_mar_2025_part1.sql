-- Backfill March 2025 Part 1 (1-15)
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2025-03-01';
  end_date DATE := '2025-03-15';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling March 2025 Part 1 (Mar 1-15)';

  WHILE processing_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(processing_date);
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    IF days_processed % 5 = 0 THEN
      RAISE NOTICE '  ✅ Processed % days', days_processed;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ March 2025 Part 1 complete: % days', days_processed;
END $$;
