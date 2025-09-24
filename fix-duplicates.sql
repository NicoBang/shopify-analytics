-- fix-duplicates.sql
-- Kør dette direkte i Supabase SQL Editor

-- Step 1: Check for duplicates
WITH duplicate_check AS (
  SELECT
    shop,
    order_id,
    sku,
    created_at,
    COUNT(*) as duplicate_count
  FROM skus
  WHERE created_at >= '2025-01-16' AND created_at < '2025-01-17'
  GROUP BY shop, order_id, sku, created_at
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) as total_duplicate_groups,
  SUM(duplicate_count - 1) as total_duplicate_records
FROM duplicate_check;

-- Step 2: Show sample of duplicates for verification
SELECT shop, order_id, sku, created_at, quantity, id
FROM skus
WHERE (shop, order_id, sku) IN (
  SELECT shop, order_id, sku
  FROM skus
  GROUP BY shop, order_id, sku
  HAVING COUNT(*) > 1
)
ORDER BY shop, order_id, sku, created_at
LIMIT 20;

-- Step 3: Remove duplicates (keeping the first/oldest record)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY shop, order_id, sku
      ORDER BY created_at, id
    ) as rn
  FROM skus
)
DELETE FROM skus
WHERE id IN (
  SELECT id
  FROM duplicates
  WHERE rn > 1
);

-- Step 4: Verify counts after deletion
SELECT
  COUNT(*) as total_records,
  COUNT(DISTINCT (shop, order_id, sku)) as unique_combinations
FROM skus;

-- Step 5: Create unique constraint if it doesn't exist
-- First check if constraint exists
SELECT conname
FROM pg_constraint
WHERE conname = 'skus_unique_shop_order_sku';

-- If it doesn't exist, create it
ALTER TABLE skus
ADD CONSTRAINT skus_unique_shop_order_sku
UNIQUE (shop, order_id, sku);

-- Step 6: Verify data for specific date (2025-01-16)
SELECT
  SUM(quantity) as total_sold,
  COUNT(*) as total_records,
  COUNT(DISTINCT sku) as unique_skus
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17';

-- Step 7: Check specific artikelnummer 20204
SELECT
  shop,
  sku,
  SUM(quantity) as total_quantity,
  COUNT(*) as record_count
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17'
  AND sku LIKE '20204%'
GROUP BY shop, sku
ORDER BY shop, sku;