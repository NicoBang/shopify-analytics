-- Backfill all daily_color_metrics and daily_sku_metrics with corrected calculations
-- This re-aggregates ALL historical data from 2024-09-17 onwards
-- Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

-- ============================================================================
-- Backfill daily_color_metrics (artikelnummer level)
-- ============================================================================
DO $$
DECLARE
  start_date DATE := '2024-09-17';  -- Earliest data in daily_color_metrics
  end_date DATE := CURRENT_DATE;
  processing_date DATE;
  total_days INT;
  days_processed INT := 0;
BEGIN
  total_days := end_date - start_date + 1;

  RAISE NOTICE '🔄 Starting backfill of daily_color_metrics from % to % (% days)',
    start_date, end_date, total_days;

  processing_date := start_date;

  WHILE processing_date <= end_date LOOP
    -- Call the fixed aggregate function for this date
    PERFORM aggregate_color_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    -- Progress update every 30 days
    IF days_processed % 30 = 0 THEN
      RAISE NOTICE '  ✅ Processed % / % days (%.1f%% complete)',
        days_processed, total_days, (days_processed::float / total_days * 100);
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ Backfill complete: % days processed', days_processed;

  -- Show summary statistics
  RAISE NOTICE '';
  RAISE NOTICE '📊 Summary for daily_color_metrics:';
  RAISE NOTICE '  Total rows: %', (SELECT COUNT(*) FROM daily_color_metrics);
  RAISE NOTICE '  Date range: % to %',
    (SELECT MIN(metric_date) FROM daily_color_metrics),
    (SELECT MAX(metric_date) FROM daily_color_metrics);
  RAISE NOTICE '  Total solgt (should exclude cancelled): %',
    (SELECT SUM(solgt) FROM daily_color_metrics);
  RAISE NOTICE '  Total cancelled (tracked separately): %',
    (SELECT SUM(cancelled) FROM daily_color_metrics);
  RAISE NOTICE '  Total omsaetning_net (should exclude cancelled_amount): %.2f kr',
    (SELECT SUM(omsaetning_net) FROM daily_color_metrics);
  RAISE NOTICE '  Total cancelled_amount (tracked separately): %.2f kr',
    (SELECT SUM(cancelled_amount) FROM daily_color_metrics);
END $$;

-- ============================================================================
-- Backfill daily_sku_metrics (full SKU level with size)
-- ============================================================================
DO $$
DECLARE
  start_date DATE := '2024-09-17';  -- Earliest data in daily_sku_metrics
  end_date DATE := CURRENT_DATE;
  processing_date DATE;
  total_days INT;
  days_processed INT := 0;
BEGIN
  total_days := end_date - start_date + 1;

  RAISE NOTICE '';
  RAISE NOTICE '🔄 Starting backfill of daily_sku_metrics from % to % (% days)',
    start_date, end_date, total_days;

  processing_date := start_date;

  WHILE processing_date <= end_date LOOP
    -- Call the fixed aggregate function for this date
    PERFORM aggregate_sku_metrics_for_date(processing_date);

    days_processed := days_processed + 1;

    -- Progress update every 30 days
    IF days_processed % 30 = 0 THEN
      RAISE NOTICE '  ✅ Processed % / % days (%.1f%% complete)',
        days_processed, total_days, (days_processed::float / total_days * 100);
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE '✅ Backfill complete: % days processed', days_processed;

  -- Show summary statistics
  RAISE NOTICE '';
  RAISE NOTICE '📊 Summary for daily_sku_metrics:';
  RAISE NOTICE '  Total rows: %', (SELECT COUNT(*) FROM daily_sku_metrics);
  RAISE NOTICE '  Date range: % to %',
    (SELECT MIN(metric_date) FROM daily_sku_metrics),
    (SELECT MAX(metric_date) FROM daily_sku_metrics);
  RAISE NOTICE '  Total solgt (should exclude cancelled): %',
    (SELECT SUM(solgt) FROM daily_sku_metrics);
  RAISE NOTICE '  Total cancelled (tracked separately): %',
    (SELECT SUM(cancelled) FROM daily_sku_metrics);
  RAISE NOTICE '  Total omsaetning_net (should exclude cancelled_amount): %.2f kr',
    (SELECT SUM(omsaetning_net) FROM daily_sku_metrics);
  RAISE NOTICE '  Total cancelled_amount (tracked separately): %.2f kr',
    (SELECT SUM(cancelled_amount) FROM daily_sku_metrics);
END $$;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Test case: Compare 2025-10-21 with known values
DO $$
DECLARE
  color_total INT;
  shop_total INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🧪 Verification Test: 2025-10-21';
  RAISE NOTICE '';

  -- Get totals from both tables
  SELECT SUM(solgt) INTO color_total FROM daily_color_metrics WHERE metric_date = '2025-10-21';
  SELECT SUM(sku_quantity_gross) INTO shop_total FROM daily_shop_metrics WHERE metric_date = '2025-10-21';

  RAISE NOTICE 'daily_color_metrics total solgt: %', color_total;
  RAISE NOTICE 'daily_shop_metrics total sku_quantity_gross: %', shop_total;

  IF color_total = shop_total THEN
    RAISE NOTICE '✅ PASS: Color metrics matches shop metrics!';
  ELSE
    RAISE NOTICE '❌ FAIL: Mismatch! Difference: %', ABS(color_total - shop_total);
  END IF;

  -- Show breakdown by shop
  RAISE NOTICE '';
  RAISE NOTICE 'Breakdown by shop (2025-10-21):';
  FOR rec IN
    SELECT
      shop,
      sku_quantity_gross
    FROM daily_shop_metrics
    WHERE metric_date = '2025-10-21'
    ORDER BY shop
  LOOP
    RAISE NOTICE '  %: % stk', rec.shop, rec.sku_quantity_gross;
  END LOOP;
END $$;
