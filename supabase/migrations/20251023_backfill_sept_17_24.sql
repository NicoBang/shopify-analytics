-- Backfill Sept 17-24, 2025
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

DO $$
DECLARE
  processing_date DATE := '2025-09-17';
  end_date DATE := '2025-09-24';
  days_processed INT := 0;
BEGIN
  RAISE NOTICE '🔄 Backfilling Sept 17-24, 2025';

  WHILE processing_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(processing_date);
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;
    RAISE NOTICE '  ✅ Processed day % (date: %)', days_processed, processing_date;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ Sept 17-24 complete: % days', days_processed;
END $$;
