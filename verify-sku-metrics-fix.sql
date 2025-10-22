-- Verify daily_sku_metrics omsaetning_net fix

-- Test 1: Check 2025-10-01 totals (should match daily_color_metrics)
SELECT
  '✅ Test 1: 2025-10-01 totals' AS test_name,
  SUM(omsaetning_net) as total_omsaetning_net,
  SUM(refunded_amount) as total_refunded_amount,
  SUM(solgt) as total_solgt,
  SUM(retur) as total_retur
FROM daily_sku_metrics
WHERE metric_date = '2025-10-01';

-- Test 2: Check specific SKU from artikelnummer 100145
SELECT
  '✅ Test 2: SKUs from artikelnummer 100145 (2025-10-01)' AS test_name,
  metric_date,
  sku,
  artikelnummer,
  stoerrelse,
  solgt,
  retur,
  omsaetning_net,
  refunded_amount
FROM daily_sku_metrics
WHERE metric_date = '2025-10-01' AND artikelnummer = '100145'
ORDER BY sku;

-- Test 3: Compare daily_sku_metrics vs daily_color_metrics aggregation
WITH sku_totals AS (
  SELECT
    metric_date,
    artikelnummer,
    SUM(solgt) as solgt,
    SUM(retur) as retur,
    SUM(omsaetning_net) as omsaetning_net,
    SUM(refunded_amount) as refunded_amount
  FROM daily_sku_metrics
  WHERE metric_date = '2025-10-01'
  GROUP BY metric_date, artikelnummer
),
color_totals AS (
  SELECT
    metric_date,
    artikelnummer,
    solgt,
    retur,
    omsaetning_net,
    refunded_amount
  FROM daily_color_metrics
  WHERE metric_date = '2025-10-01'
)
SELECT
  '✅ Test 3: Compare SKU aggregation vs Color metrics' AS test_name,
  s.artikelnummer,
  s.solgt as sku_solgt,
  c.solgt as color_solgt,
  s.retur as sku_retur,
  c.retur as color_retur,
  s.omsaetning_net as sku_omsaetning,
  c.omsaetning_net as color_omsaetning,
  (s.omsaetning_net - c.omsaetning_net) as difference
FROM sku_totals s
FULL OUTER JOIN color_totals c ON s.artikelnummer = c.artikelnummer AND s.metric_date = c.metric_date
WHERE ABS(s.omsaetning_net - c.omsaetning_net) > 0.01  -- Show only differences > 1 øre
ORDER BY ABS(s.omsaetning_net - c.omsaetning_net) DESC
LIMIT 10;

-- Test 4: Sample of different SKUs
SELECT
  '✅ Test 4: Sample of SKUs (2025-10-01)' AS test_name,
  sku,
  artikelnummer,
  stoerrelse,
  solgt,
  retur,
  omsaetning_net,
  refunded_amount
FROM daily_sku_metrics
WHERE metric_date = '2025-10-01'
ORDER BY omsaetning_net DESC
LIMIT 15;
