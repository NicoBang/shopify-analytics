-- final-duplicate-cleanup.sql
-- FINAL CLEANUP: Remove all remaining duplicates from the skus table

-- ============================================
-- STEP 1: VERIFY THE PROBLEM
-- ============================================

-- Check total duplicates across entire database
SELECT
  'Total duplicates check' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as duplicate_records
FROM skus;

-- Check Jan 16 specifically (where we found the issue)
SELECT
  'Jan 16, 2025 check' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as duplicate_records
FROM skus
WHERE created_at >= '2025-01-16' AND created_at < '2025-01-17';

-- ============================================
-- STEP 2: BACKUP TABLE (SAFETY)
-- ============================================

-- Create backup before final cleanup
CREATE TABLE IF NOT EXISTS skus_backup_final_cleanup AS
SELECT * FROM skus;

-- Verify backup was created
SELECT COUNT(*) as backup_count FROM skus_backup_final_cleanup;

-- ============================================
-- STEP 3: REMOVE ALL DUPLICATES
-- ============================================

-- Delete duplicates, keeping the record with:
-- 1. Refund information (if available)
-- 2. Higher refunded_qty
-- 3. Latest created_at
-- 4. Highest ID (as final tiebreaker)

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
        -- Priority 1: Keep records with refund_date
        CASE WHEN refund_date IS NOT NULL THEN 0 ELSE 1 END,
        -- Priority 2: Keep records with higher refunded_qty
        refunded_qty DESC NULLS LAST,
        -- Priority 3: Keep newer records
        created_at DESC,
        -- Priority 4: Keep higher ID (latest insert)
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
-- STEP 4: VERIFY CLEANUP SUCCESS
-- ============================================

-- Check that duplicates are gone
SELECT
  'After cleanup - total' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as remaining_duplicates
FROM skus;

-- Verify Jan 16 specifically
SELECT
  'After cleanup - Jan 16' as analysis,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(shop, '-', order_id, '-', sku)) as unique_combinations
FROM skus
WHERE created_at >= '2025-01-16' AND created_at < '2025-01-17';

-- Check artikel 20204 on Jan 16
SELECT
  'Artikel 20204 - Jan 16' as check,
  COUNT(*) as records,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded,
  SUM(quantity) - SUM(refunded_qty) as net_sold
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17'
  AND sku LIKE '20204%';

-- ============================================
-- STEP 5: ADD UNIQUE CONSTRAINT
-- ============================================

-- Drop existing constraint if it exists
ALTER TABLE skus
DROP CONSTRAINT IF EXISTS skus_unique_shop_order_sku;

-- Add unique constraint to prevent future duplicates
ALTER TABLE skus
ADD CONSTRAINT skus_unique_shop_order_sku
UNIQUE (shop, order_id, sku);

-- ============================================
-- STEP 6: FINAL VERIFICATION
-- ============================================

-- Get final statistics
SELECT
  'Final database state' as status,
  COUNT(*) as total_records,
  COUNT(DISTINCT sku) as unique_skus,
  COUNT(DISTINCT order_id) as unique_orders,
  COUNT(DISTINCT shop) as shops
FROM skus;

-- ============================================
-- STEP 7: CLEANUP (OPTIONAL)
-- ============================================

-- If everything looks good, you can drop the backup table
-- ONLY run this after verifying the cleanup was successful!
-- DROP TABLE IF EXISTS skus_backup_final_cleanup;
-- DROP TABLE IF EXISTS skus_backup_before_dedup;

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- 1. Run STEP 1 to see the current duplicate situation
-- 2. Run STEP 2 to create a backup
-- 3. Run STEP 3 to remove all duplicates
-- 4. Run STEP 4 to verify the cleanup worked
-- 5. Run STEP 5 to add constraint preventing future duplicates
-- 6. Run STEP 6 for final verification
-- 7. Once confirmed working, optionally run STEP 7 to remove backups