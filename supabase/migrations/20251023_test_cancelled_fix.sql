-- Test that cancelled items are correctly excluded from solgt and omsaetning_net
-- This verifies the fix from 20251023_fix_cancelled_in_metrics.sql

-- Test 1: Compare raw SKU data with aggregated metrics for 2025-09-09 to 2025-09-11
WITH raw_skus AS (
  SELECT
    SUM(quantity) as total_qty,
    SUM(quantity - COALESCE(cancelled_qty, 0)) as qty_excl_cancelled,
    SUM(COALESCE(cancelled_qty, 0)) as total_cancelled,
    SUM((price_dkk * quantity)) as gross_revenue,
    SUM((price_dkk * quantity) - COALESCE(cancelled_amount_dkk, 0)) as revenue_excl_cancelled,
    SUM(COALESCE(cancelled_amount_dkk, 0)) as total_cancelled_amount
  FROM skus
  WHERE created_at_original >= '2025-09-09T00:00:00Z'
    AND created_at_original < '2025-09-12T00:00:00Z'
),
aggregated AS (
  SELECT
    SUM(solgt) as agg_solgt,
    SUM(cancelled) as agg_cancelled,
    SUM(omsaetning_net) as agg_omsaetning,
    SUM(cancelled_amount) as agg_cancelled_amount
  FROM daily_color_metrics
  WHERE metric_date >= '2025-09-09'
    AND metric_date <= '2025-09-11'
)
SELECT
  '2025-09-09 to 2025-09-11 Test Results' as test_date,

  -- Quantities
  raw.total_qty as raw_total_qty,
  raw.qty_excl_cancelled as raw_qty_after_cancelled,
  raw.total_cancelled as raw_cancelled_qty,
  agg.agg_solgt as aggregated_solgt,
  agg.agg_cancelled as aggregated_cancelled,

  -- Match check for quantities
  CASE
    WHEN raw.qty_excl_cancelled = agg.agg_solgt
    THEN '✅ PASS: solgt excludes cancelled'
    ELSE '❌ FAIL: solgt should be ' || raw.qty_excl_cancelled || ' but is ' || agg.agg_solgt
  END as qty_test,

  -- Revenue
  raw.gross_revenue as raw_gross_revenue,
  raw.revenue_excl_cancelled as raw_revenue_after_cancelled,
  raw.total_cancelled_amount as raw_cancelled_amount,
  agg.agg_omsaetning as aggregated_omsaetning,
  agg.agg_cancelled_amount as aggregated_cancelled_amount,

  -- Match check for revenue
  CASE
    WHEN ABS(raw.revenue_excl_cancelled - agg.agg_omsaetning) < 0.01
    THEN '✅ PASS: omsaetning excludes cancelled'
    ELSE '❌ FAIL: omsaetning should be ' || raw.revenue_excl_cancelled || ' but is ' || agg.agg_omsaetning
  END as revenue_test

FROM raw_skus raw, aggregated agg;

-- Test 2: Show example SKUs with cancelled items
SELECT
  '--- Example SKUs with cancelled items ---' as section,
  order_id,
  sku,
  quantity,
  cancelled_qty,
  (quantity - COALESCE(cancelled_qty, 0)) as qty_after_cancelled,
  price_dkk,
  (price_dkk * quantity) as gross_amount,
  cancelled_amount_dkk,
  ((price_dkk * quantity) - COALESCE(cancelled_amount_dkk, 0)) as amount_after_cancelled
FROM skus
WHERE created_at_original >= '2025-09-09T00:00:00Z'
  AND created_at_original < '2025-09-12T00:00:00Z'
  AND cancelled_qty > 0
LIMIT 5;

-- Test 3: Compare with daily_shop_metrics (should also match)
SELECT
  '--- Comparison with daily_shop_metrics ---' as section,
  (SELECT SUM(solgt) FROM daily_color_metrics WHERE metric_date >= '2025-09-09' AND metric_date <= '2025-09-11') as color_solgt,
  (SELECT SUM(sku_quantity_gross) FROM daily_shop_metrics WHERE metric_date >= '2025-09-09' AND metric_date <= '2025-09-11') as shop_sku_qty_gross,
  CASE
    WHEN (SELECT SUM(solgt) FROM daily_color_metrics WHERE metric_date >= '2025-09-09' AND metric_date <= '2025-09-11') =
         (SELECT SUM(sku_quantity_gross) FROM daily_shop_metrics WHERE metric_date >= '2025-09-09' AND metric_date <= '2025-09-11')
    THEN '✅ PASS: color_metrics matches shop_metrics'
    ELSE '❌ FAIL: Mismatch between color_metrics and shop_metrics'
  END as cross_table_test;
