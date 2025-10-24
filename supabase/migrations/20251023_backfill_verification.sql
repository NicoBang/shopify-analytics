-- Verification test: Compare 2025-10-21 after backfill
-- Should be run AFTER all backfill scripts

DO $$
DECLARE
  color_total INT;
  shop_total INT;
  color_omsaetning NUMERIC;
  color_cancelled_amount NUMERIC;
  rec RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🧪 Verification Test: 2025-10-21';
  RAISE NOTICE '';

  -- Get totals from both tables
  SELECT SUM(solgt) INTO color_total FROM daily_color_metrics WHERE metric_date = '2025-10-21';
  SELECT SUM(sku_quantity_gross) INTO shop_total FROM daily_shop_metrics WHERE metric_date = '2025-10-21';

  SELECT SUM(omsaetning_net) INTO color_omsaetning FROM daily_color_metrics WHERE metric_date = '2025-10-21';
  SELECT SUM(cancelled_amount) INTO color_cancelled_amount FROM daily_color_metrics WHERE metric_date = '2025-10-21';

  RAISE NOTICE 'Quantities:';
  RAISE NOTICE '  daily_color_metrics total solgt: %', color_total;
  RAISE NOTICE '  daily_shop_metrics total sku_quantity_gross: %', shop_total;

  IF color_total = shop_total THEN
    RAISE NOTICE '  ✅ PASS: Quantities match!';
  ELSE
    RAISE NOTICE '  ❌ FAIL: Mismatch! Difference: %', ABS(color_total - shop_total);
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Revenue (should exclude cancelled):';
  RAISE NOTICE '  omsaetning_net: %.2f kr', color_omsaetning;
  RAISE NOTICE '  cancelled_amount (separate): %.2f kr', color_cancelled_amount;

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

  -- Show summary stats for all backfilled data
  RAISE NOTICE '';
  RAISE NOTICE '📊 Overall Summary:';
  RAISE NOTICE '  Total color metrics rows: %', (SELECT COUNT(*) FROM daily_color_metrics);
  RAISE NOTICE '  Total SKU metrics rows: %', (SELECT COUNT(*) FROM daily_sku_metrics);
  RAISE NOTICE '  Date range: % to %',
    (SELECT MIN(metric_date) FROM daily_color_metrics),
    (SELECT MAX(metric_date) FROM daily_color_metrics);
END $$;
