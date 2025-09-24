-- convert-created-at-to-date.sql
-- Convert created_at from timestamp to date only format

-- ============================================
-- STEP 1: CHECK CURRENT FORMAT
-- ============================================

-- Check current data type and sample values
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'skus'
  AND column_name = 'created_at';

-- Sample current values
SELECT
  created_at,
  created_at::date as date_only,
  COUNT(*) as count
FROM skus
GROUP BY created_at
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- STEP 2: BACKUP BEFORE CONVERSION
-- ============================================

-- Create backup of current timestamps (optional)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS created_at_original TIMESTAMP WITH TIME ZONE;

UPDATE skus
SET created_at_original = created_at
WHERE created_at_original IS NULL;

-- ============================================
-- STEP 3: HANDLE DEPENDENCIES AND CONVERT TO DATE
-- ============================================

-- First, check for dependent views
SELECT
  v.viewname,
  v.definition
FROM pg_views v
WHERE v.definition LIKE '%skus%'
  AND v.schemaname = 'public';

-- Drop the dependent view(s)
DROP VIEW IF EXISTS sku_analytics CASCADE;

-- Now convert the column type to DATE
-- This permanently removes time information
ALTER TABLE skus
ALTER COLUMN created_at TYPE DATE
USING created_at::date;

-- Recreate the view with the new date format
CREATE VIEW sku_analytics AS
SELECT
  shop,
  sku,
  product_title,
  variant_title,
  created_at,  -- Now this will be DATE type
  country,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded,
  SUM(quantity - COALESCE(refunded_qty, 0)) as net_sold,
  COUNT(DISTINCT order_id) as order_count,
  ROUND(AVG(price_dkk), 2) as avg_price,
  MAX(refund_date) as last_refund_date
FROM skus
GROUP BY shop, sku, product_title, variant_title, created_at, country;

-- ============================================
-- STEP 4: VERIFY CONVERSION
-- ============================================

-- Check new data type
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'skus'
  AND column_name = 'created_at';

-- Sample converted values
SELECT
  created_at,
  COUNT(*) as records_per_date
FROM skus
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY created_at
ORDER BY created_at DESC;

-- ============================================
-- STEP 5: UPDATE INDEXES (if needed)
-- ============================================

-- Drop and recreate any indexes on created_at
-- Check existing indexes first
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'skus'
  AND indexdef LIKE '%created_at%';

-- Recreate index if it existed
-- CREATE INDEX idx_skus_created_at ON skus(created_at);

-- ============================================
-- STEP 6: CLEANUP (OPTIONAL)
-- ============================================

-- If everything looks good and you don't need the backup:
-- ALTER TABLE skus DROP COLUMN IF EXISTS created_at_original;

-- ============================================
-- ALTERNATIVE: Keep timestamp but display as date
-- ============================================

-- If you want to keep the timestamp but only show date in queries:
-- CREATE OR REPLACE VIEW skus_date_view AS
-- SELECT
--   id,
--   shop,
--   order_id,
--   sku,
--   created_at::date as created_at,
--   country,
--   product_title,
--   variant_title,
--   quantity,
--   refunded_qty,
--   price_dkk,
--   refund_date
-- FROM skus;

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- 1. Run STEP 1 to check current format
-- 2. Run STEP 2 to create backup (optional but recommended)
-- 3. Run STEP 3 to convert to DATE type
-- 4. Run STEP 4 to verify conversion
-- 5. Run STEP 5 if you have indexes on created_at
-- 6. Run STEP 6 to remove backup column once verified

-- Note: After this conversion, any new data inserted must use DATE format
-- The sync code should be updated to insert dates without timestamps