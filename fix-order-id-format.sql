-- fix-order-id-format.sql
-- FIX: Standardize order_id format and remove resulting duplicates

-- ============================================
-- STEP 1: CHECK THE PROBLEM
-- ============================================

-- See how many records have each format
SELECT
  'Order ID format check' as analysis,
  COUNT(*) FILTER (WHERE order_id LIKE 'gid://%') as gid_format_count,
  COUNT(*) FILTER (WHERE order_id NOT LIKE 'gid://%') as numeric_format_count,
  COUNT(*) as total_records
FROM skus;

-- Check for examples of the same order with different formats
SELECT
  'Sample duplicate formats' as analysis,
  REPLACE(order_id, 'gid://shopify/Order/', '') as numeric_id,
  COUNT(*) as count,
  array_agg(DISTINCT order_id) as formats_found
FROM skus
WHERE created_at >= '2025-01-16' AND created_at < '2025-01-17'
GROUP BY REPLACE(order_id, 'gid://shopify/Order/', '')
HAVING COUNT(DISTINCT order_id) > 1
LIMIT 5;

-- ============================================
-- STEP 2: BACKUP BEFORE FIX
-- ============================================

-- Create backup
CREATE TABLE IF NOT EXISTS skus_backup_order_id_fix AS
SELECT * FROM skus;

-- ============================================
-- STEP 3: REMOVE DUPLICATES FIRST (BEFORE STANDARDIZING)
-- ============================================

-- First, let's identify which records will become duplicates after standardization
WITH future_duplicates AS (
  SELECT
    shop,
    REPLACE(order_id, 'gid://shopify/Order/', '') as clean_order_id,
    sku,
    COUNT(*) as duplicate_count,
    array_agg(id ORDER BY
      CASE WHEN refund_date IS NOT NULL THEN 0 ELSE 1 END,
      refunded_qty DESC NULLS LAST,
      created_at DESC,
      id DESC
    ) as all_ids
  FROM skus
  GROUP BY shop, REPLACE(order_id, 'gid://shopify/Order/', ''), sku
  HAVING COUNT(*) > 1
)
DELETE FROM skus
WHERE id IN (
  -- Delete all IDs except the first one (best) from each group
  SELECT unnest(all_ids[2:]) -- Takes all elements from position 2 onwards
  FROM future_duplicates
);

-- Now standardize all order_ids to numeric format (safe now)
UPDATE skus
SET order_id = REPLACE(order_id, 'gid://shopify/Order/', '')
WHERE order_id LIKE 'gid://%';

-- Verify the update worked
SELECT
  'After cleanup and standardization' as status,
  COUNT(*) FILTER (WHERE order_id LIKE 'gid://%') as remaining_gid_format,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations
FROM skus;

-- ============================================
-- STEP 4: REMOVE DUPLICATES CREATED BY FORMAT FIX
-- ============================================

-- Now remove duplicates, keeping records with refund info
WITH ranked_records AS (
  SELECT
    id,
    shop,
    order_id,
    sku,
    refund_date,
    refunded_qty,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY shop, order_id, sku
      ORDER BY
        -- Keep records with refund_date
        CASE WHEN refund_date IS NOT NULL THEN 0 ELSE 1 END,
        -- Keep records with higher refunded_qty
        refunded_qty DESC NULLS LAST,
        -- Keep newer records
        created_at DESC,
        -- Keep higher ID
        id DESC
    ) as rank_num
  FROM skus
)
DELETE FROM skus
WHERE id IN (
  SELECT id
  FROM ranked_records
  WHERE rank_num > 1
);

-- ============================================
-- STEP 5: VERIFY FINAL RESULT
-- ============================================

-- Check final counts
SELECT
  'Final result' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as remaining_duplicates
FROM skus;

-- Check Jan 16 specifically
SELECT
  'Jan 16 after fix' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT order_id) as unique_orders
FROM skus
WHERE created_at >= '2025-01-16' AND created_at < '2025-01-17';

-- Check artikel 20204
SELECT
  'Artikel 20204 final check' as analysis,
  COUNT(*) as records,
  SUM(quantity) as total_sold,
  SUM(refunded_qty) as total_refunded,
  SUM(quantity) - SUM(refunded_qty) as net_sold
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17'
  AND sku LIKE '20204%';

-- ============================================
-- STEP 6: ADD UNIQUE CONSTRAINT
-- ============================================

-- Drop old constraint if exists
ALTER TABLE skus
DROP CONSTRAINT IF EXISTS skus_unique_shop_order_sku;

-- Add unique constraint to prevent future duplicates
ALTER TABLE skus
ADD CONSTRAINT skus_unique_shop_order_sku
UNIQUE (shop, order_id, sku);

-- ============================================
-- STEP 7: FIX THE SOURCE CODE
-- ============================================

-- IMPORTANT: After running this SQL, we need to update the sync code
-- to always strip 'gid://shopify/Order/' from order_ids
-- This prevents the problem from happening again

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- Run each step in order:
-- 1. STEP 1 - See the problem
-- 2. STEP 2 - Create backup
-- 3. STEP 3 - Standardize all order_ids
-- 4. STEP 4 - Remove resulting duplicates
-- 5. STEP 5 - Verify it worked
-- 6. STEP 6 - Add constraint
-- Then we'll fix the sync code to prevent this