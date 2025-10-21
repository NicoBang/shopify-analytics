-- Fix kostpris calculation in daily metrics tables
-- This script updates both daily_color_metrics and daily_sku_metrics
-- to store TOTAL cost (unit_cost * solgt) instead of average unit cost

-- 1️⃣ Re-run color metrics migration with fixed kostpris calculation
\i supabase/migrations/20251020_backfill_daily_color_metrics_corrected.sql

-- 2️⃣ Re-run SKU metrics migration with fixed kostpris calculation
\i supabase/migrations/20251020_backfill_daily_sku_metrics_corrected.sql

-- 3️⃣ Verify results
SELECT
  'daily_color_metrics' as table_name,
  COUNT(*) as total_rows,
  SUM(omsaetning_net) as total_omsaetning,
  SUM(kostpris) as total_kostpris,
  SUM(omsaetning_net) - SUM(kostpris) as total_db
FROM daily_color_metrics
WHERE metric_date >= '2024-09-30' AND metric_date <= '2024-09-30'

UNION ALL

SELECT
  'daily_sku_metrics' as table_name,
  COUNT(*) as total_rows,
  SUM(omsaetning_net) as total_omsaetning,
  SUM(kostpris) as total_kostpris,
  SUM(omsaetning_net) - SUM(kostpris) as total_db
FROM daily_sku_metrics
WHERE metric_date >= '2024-09-30' AND metric_date <= '2024-09-30';
