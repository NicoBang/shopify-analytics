-- Backfill December 2024
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2024-12-01';
  end_date DATE := '2024-12-31';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling December 2024';

  WHILE processing_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(processing_date);
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    IF days_processed % 10 = 0 THEN
      RAISE NOTICE '  ✅ Processed % days', days_processed;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ December 2024 complete: % days', days_processed;
END $$;
