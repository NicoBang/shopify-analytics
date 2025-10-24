-- Verification test: Compare 2025-10-21 after backfill
-- Returns results as table instead of RAISE NOTICE

WITH verification AS (
  SELECT
    'Quantities' as test_type,
    (SELECT SUM(solgt) FROM daily_color_metrics WHERE metric_date = '2025-10-21') as color_total,
    (SELECT SUM(sku_quantity_gross) FROM daily_shop_metrics WHERE metric_date = '2025-10-21') as shop_total,
    NULL::numeric as revenue_value,
    NULL::text as shop_name

  UNION ALL

  SELECT
    'Revenue',
    NULL,
    NULL,
    (SELECT SUM(omsaetning_net) FROM daily_color_metrics WHERE metric_date = '2025-10-21'),
    'omsaetning_net'

  UNION ALL

  SELECT
    'Revenue',
    NULL,
    NULL,
    (SELECT SUM(cancelled_amount) FROM daily_color_metrics WHERE metric_date = '2025-10-21'),
    'cancelled_amount'

  UNION ALL

  SELECT
    'Shop Breakdown',
    sku_quantity_gross,
    NULL,
    NULL,
    shop
  FROM daily_shop_metrics
  WHERE metric_date = '2025-10-21'
)
SELECT
  test_type,
  color_total,
  shop_total,
  CASE
    WHEN color_total IS NOT NULL AND shop_total IS NOT NULL
    THEN
      CASE WHEN color_total = shop_total
      THEN '✅ PASS'
      ELSE '❌ FAIL: Diff ' || ABS(color_total - shop_total)::text
      END
    ELSE NULL
  END as match_status,
  revenue_value,
  shop_name
FROM verification
ORDER BY
  CASE test_type
    WHEN 'Quantities' THEN 1
    WHEN 'Revenue' THEN 2
    WHEN 'Shop Breakdown' THEN 3
  END,
  shop_name;

-- Summary stats
SELECT
  'Summary' as info_type,
  (SELECT COUNT(*) FROM daily_color_metrics) as color_rows,
  (SELECT COUNT(*) FROM daily_sku_metrics) as sku_rows,
  (SELECT MIN(metric_date) FROM daily_color_metrics) as date_from,
  (SELECT MAX(metric_date) FROM daily_color_metrics) as date_to;
