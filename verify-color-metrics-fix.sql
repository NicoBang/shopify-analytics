-- Verify daily_color_metrics omsaetning_net fix

-- Test 1: Check 2025-10-01 totals
SELECT
  '✅ Test 1: 2025-10-01 totals' AS test_name,
  SUM(omsaetning_net) as total_omsaetning_net,
  SUM(refunded_amount) as total_refunded_amount,
  SUM(solgt) as total_solgt,
  SUM(retur) as total_retur
FROM daily_color_metrics
WHERE metric_date = '2025-10-01';

-- Test 2: Check artikelnummer 100145 specifically
SELECT
  '✅ Test 2: Artikelnummer 100145 (2025-10-01)' AS test_name,
  metric_date,
  artikelnummer,
  solgt,
  retur,
  omsaetning_net,
  refunded_amount,
  (omsaetning_net - refunded_amount) as net_after_refunds
FROM daily_color_metrics
WHERE metric_date = '2025-10-01' AND artikelnummer = '100145';

-- Test 3: Compare with daily_shop_metrics
WITH shop_totals AS (
  SELECT
    SUM(revenue_gross) as revenue_gross,
    SUM(cancelled_amount) as cancelled_amount,
    SUM(order_discount_total) as order_discount_total,
    SUM(return_amount) as return_amount
  FROM daily_shop_metrics
  WHERE metric_date = '2025-10-01'
),
color_totals AS (
  SELECT
    SUM(omsaetning_net) as omsaetning_net,
    SUM(refunded_amount) as refunded_amount
  FROM daily_color_metrics
  WHERE metric_date = '2025-10-01'
)
SELECT
  '✅ Test 3: Compare daily_shop_metrics vs daily_color_metrics' AS test_name,
  s.revenue_gross,
  s.cancelled_amount,
  s.order_discount_total,
  (s.revenue_gross - s.cancelled_amount - s.order_discount_total) as expected_omsaetning,
  c.omsaetning_net as actual_omsaetning,
  s.return_amount,
  c.refunded_amount,
  (c.omsaetning_net - c.refunded_amount) as net_after_refunds,
  ((s.revenue_gross - s.cancelled_amount - s.order_discount_total) - (c.omsaetning_net - c.refunded_amount)) as difference
FROM shop_totals s, color_totals c;

-- Test 4: Sample of different artikelnummer
SELECT
  '✅ Test 4: Sample of artikelnummer (2025-10-01)' AS test_name,
  artikelnummer,
  solgt,
  retur,
  omsaetning_net,
  refunded_amount
FROM daily_color_metrics
WHERE metric_date = '2025-10-01'
ORDER BY omsaetning_net DESC
LIMIT 10;
