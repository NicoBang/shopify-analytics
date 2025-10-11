-- CHECK ACTUAL SKU COVERAGE
-- Shows exactly what data we have vs what we need

-- 1. SUMMARY: Coverage per shop
WITH date_range AS (
  SELECT COUNT(*)::int as total_days
  FROM generate_series('2024-09-30'::date, '2025-10-09'::date, '1 day'::interval)
),
coverage AS (
  SELECT
    shop,
    COUNT(DISTINCT DATE(created_at_original)) as days_with_data,
    MIN(DATE(created_at_original))::text as first_date,
    MAX(DATE(created_at_original))::text as last_date,
    COUNT(*) as total_skus,
    SUM(quantity) as total_items
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
  GROUP BY shop
)
SELECT
  c.shop,
  c.days_with_data || '/' || d.total_days as days_coverage,
  ROUND(100.0 * c.days_with_data / d.total_days, 1) || '%' as percent,
  d.total_days - c.days_with_data as missing_days,
  c.total_skus,
  c.first_date || ' to ' || c.last_date as period
FROM coverage c
CROSS JOIN date_range d
ORDER BY c.shop;

-- 2. DETAILS: Show exactly which dates are missing
WITH all_dates AS (
  SELECT generate_series('2024-09-30'::date, '2025-10-09'::date, '1 day'::interval)::date as date
),
all_shops AS (
  SELECT unnest(ARRAY[
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ]) as shop
),
expected AS (
  SELECT s.shop, d.date
  FROM all_shops s
  CROSS JOIN all_dates d
),
actual AS (
  SELECT DISTINCT shop, DATE(created_at_original) as date
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
)
SELECT
  e.shop,
  COUNT(*) as missing_days,
  STRING_AGG(e.date::text, ', ' ORDER BY e.date) as missing_dates
FROM expected e
LEFT JOIN actual a ON e.shop = a.shop AND e.date = a.date
WHERE a.date IS NULL
GROUP BY e.shop
HAVING COUNT(*) > 0
ORDER BY e.shop;

-- 3. JOB STATUS: What's happening with jobs?
SELECT
  status,
  COUNT(*) as job_count,
  COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour') as completed_last_hour
FROM bulk_sync_jobs
WHERE object_type = 'skus'
  AND start_date >= '2024-09-30'
  AND start_date <= '2025-10-09'
GROUP BY status;

-- 4. RECENT ACTIVITY: What was synced in last hour?
SELECT
  shop,
  COUNT(*) as jobs_completed,
  MIN(start_date) as earliest_date,
  MAX(start_date) as latest_date
FROM bulk_sync_jobs
WHERE object_type = 'skus'
  AND status = 'completed'
  AND completed_at > NOW() - INTERVAL '1 hour'
GROUP BY shop
ORDER BY shop;