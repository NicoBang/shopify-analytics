-- COMPLETE SKU SYNC VERIFICATION
-- Shows EXACTLY what data you have and what's missing
-- Period: 2024-09-30 to 2025-10-09

-- 1. OVERVIEW: What's the current coverage?
WITH date_range AS (
  SELECT generate_series(
    '2024-09-30'::date,
    '2025-10-09'::date,
    '1 day'::interval
  )::date as sync_date
),
shops AS (
  SELECT unnest(ARRAY[
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ]) as shop_name
),
expected_combinations AS (
  SELECT s.shop_name, d.sync_date
  FROM shops s
  CROSS JOIN date_range d
),
actual_data AS (
  SELECT
    shop,
    DATE(created_at_original) as sync_date,
    COUNT(DISTINCT order_id) as order_count,
    COUNT(*) as sku_count,
    SUM(quantity) as total_items
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
  GROUP BY shop, DATE(created_at_original)
)
SELECT
  e.shop_name,
  COUNT(*) FILTER (WHERE a.sku_count > 0) as days_with_data,
  COUNT(*) FILTER (WHERE a.sku_count IS NULL OR a.sku_count = 0) as days_missing,
  COUNT(*) as total_days_expected,
  ROUND(100.0 * COUNT(*) FILTER (WHERE a.sku_count > 0) / COUNT(*), 1) as coverage_percent,
  COALESCE(SUM(a.sku_count), 0) as total_skus,
  COALESCE(SUM(a.order_count), 0) as total_orders
FROM expected_combinations e
LEFT JOIN actual_data a ON e.shop_name = a.shop AND e.sync_date = a.sync_date
GROUP BY e.shop_name
ORDER BY e.shop_name;

-- 2. DETAILED: Show EXACTLY which dates are missing per shop
WITH date_range AS (
  SELECT generate_series(
    '2024-09-30'::date,
    '2025-10-09'::date,
    '1 day'::interval
  )::date as sync_date
),
shops AS (
  SELECT unnest(ARRAY[
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ]) as shop_name
),
expected AS (
  SELECT s.shop_name, d.sync_date
  FROM shops s
  CROSS JOIN date_range d
),
actual AS (
  SELECT
    shop,
    DATE(created_at_original) as sync_date,
    COUNT(*) as sku_count
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
  GROUP BY shop, DATE(created_at_original)
)
SELECT
  e.shop_name,
  STRING_AGG(
    CASE WHEN a.sku_count IS NULL OR a.sku_count = 0
    THEN e.sync_date::text
    END, ', ' ORDER BY e.sync_date
  ) as missing_dates
FROM expected e
LEFT JOIN actual a ON e.shop_name = a.shop AND e.sync_date = a.sync_date
WHERE a.sku_count IS NULL OR a.sku_count = 0
GROUP BY e.shop_name
HAVING COUNT(*) > 0
ORDER BY e.shop_name;

-- 3. JOB STATUS: What's the status of sync jobs?
SELECT
  shop,
  object_type,
  status,
  COUNT(*) as job_count,
  MIN(start_date) as earliest_date,
  MAX(start_date) as latest_date
FROM bulk_sync_jobs
WHERE start_date >= '2024-09-30'
  AND start_date <= '2025-10-09'
  AND object_type IN ('skus', 'orders')
GROUP BY shop, object_type, status
ORDER BY shop, object_type, status;

-- 4. FAILED JOBS DETAIL: Which specific dates failed?
SELECT
  shop,
  start_date,
  object_type,
  status,
  error_message
FROM bulk_sync_jobs
WHERE start_date >= '2024-09-30'
  AND start_date <= '2025-10-09'
  AND status = 'failed'
  AND object_type = 'skus'
ORDER BY shop, start_date;