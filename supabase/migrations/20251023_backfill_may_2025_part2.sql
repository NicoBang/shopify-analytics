-- Backfill May 2025 Part 2 (16-31)
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2025-05-16';
  end_date DATE := '2025-05-31';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling May 2025 Part 2 (May 16-31)';

  WHILE processing_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(processing_date);
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    IF days_processed % 5 = 0 THEN
      RAISE NOTICE '  ✅ Processed % days', days_processed;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ May 2025 Part 2 complete: % days', days_processed;
END $$;
