-- Find exactly which shop/date combinations are missing
WITH expected AS (
  SELECT 
    shop,
    date::date as start_date
  FROM 
    (SELECT unnest(ARRAY[
      'pompdelux-da.myshopify.com',
      'pompdelux-de.myshopify.com', 
      'pompdelux-nl.myshopify.com',
      'pompdelux-int.myshopify.com',
      'pompdelux-chf.myshopify.com'
    ]) as shop) shops
  CROSS JOIN
    generate_series('2024-09-30'::date, '2025-10-09'::date, '1 day'::interval) as date
),
existing AS (
  SELECT DISTINCT shop, start_date
  FROM bulk_sync_jobs
  WHERE object_type = 'skus'
    AND start_date >= '2024-09-30'
    AND start_date <= '2025-10-09'
)
SELECT 
  e.shop,
  COUNT(*) as missing_count,
  MIN(e.start_date) as first_missing,
  MAX(e.start_date) as last_missing
FROM expected e
LEFT JOIN existing ex ON e.shop = ex.shop AND e.start_date = ex.start_date
WHERE ex.shop IS NULL
GROUP BY e.shop
ORDER BY e.shop;
