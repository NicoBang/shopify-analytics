-- Validation Query for September-October 2025 Historical Sync
-- Run this after bulk sync completes

-- 1. Daily Summary
SELECT
  DATE(created_at) as order_date,
  COUNT(DISTINCT order_id) as orders,
  COUNT(*) as sku_lines,
  SUM(quantity) as total_qty,
  SUM(refunded_qty) as refunded_qty,
  ROUND(SUM(price_dkk * quantity), 2) as revenue_dkk
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com'
  AND created_at >= '2025-09-01'
  AND created_at < '2025-11-01'
GROUP BY DATE(created_at)
ORDER BY order_date;

-- 2. Overall Summary
SELECT
  'September-October 2025' as period,
  COUNT(DISTINCT order_id) as total_orders,
  COUNT(*) as total_sku_lines,
  SUM(quantity) as total_qty,
  SUM(refunded_qty) as total_refunded_qty,
  ROUND(SUM(price_dkk * quantity), 2) as total_revenue_dkk,
  ROUND(SUM(cancelled_amount_dkk), 2) as total_refunded_dkk,
  COUNT(CASE WHEN refund_date IS NOT NULL THEN 1 END) as skus_with_refunds
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com'
  AND created_at >= '2025-09-01'
  AND created_at < '2025-11-01';

-- 3. Check for gaps (missing days)
WITH date_series AS (
  SELECT generate_series(
    '2025-09-01'::date,
    '2025-10-31'::date,
    '1 day'::interval
  )::date as check_date
),
actual_dates AS (
  SELECT DISTINCT DATE(created_at) as order_date
  FROM skus
  WHERE shop = 'pompdelux-da.myshopify.com'
    AND created_at >= '2025-09-01'
    AND created_at < '2025-11-01'
)
SELECT
  ds.check_date,
  CASE WHEN ad.order_date IS NULL THEN '❌ MISSING' ELSE '✅ OK' END as status
FROM date_series ds
LEFT JOIN actual_dates ad ON ds.check_date = ad.order_date
ORDER BY ds.check_date;

-- 4. Refund Coverage
SELECT
  COUNT(*) as total_skus,
  COUNT(CASE WHEN refund_date IS NOT NULL THEN 1 END) as skus_with_refunds,
  ROUND(100.0 * COUNT(CASE WHEN refund_date IS NOT NULL THEN 1 END) / COUNT(*), 2) as refund_coverage_percent
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com'
  AND created_at >= '2025-09-01'
  AND created_at < '2025-11-01';
