-- add-cancelled-qty-to-skus.sql
-- Add cancelled_qty column to skus table to match orders table structure

-- ============================================
-- STEP 1: CHECK CURRENT STRUCTURE
-- ============================================

-- Check if column already exists
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'skus'
  AND column_name = 'cancelled_qty';

-- View current skus columns
SELECT
  column_name,
  data_type,
  ordinal_position
FROM information_schema.columns
WHERE table_name = 'skus'
ORDER BY ordinal_position;

-- ============================================
-- STEP 2: ADD CANCELLED_QTY COLUMN
-- ============================================

-- Add the column if it doesn't exist
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS cancelled_qty INTEGER DEFAULT 0;

-- ============================================
-- STEP 3: UPDATE EXISTING VIEWS
-- ============================================

-- Drop and recreate the sku_analytics view with new column
DROP VIEW IF EXISTS sku_analytics CASCADE;

CREATE VIEW sku_analytics AS
SELECT
  shop,
  sku,
  product_title,
  variant_title,
  created_at,
  country,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded,
  SUM(cancelled_qty) as total_cancelled,
  SUM(quantity - COALESCE(refunded_qty, 0) - COALESCE(cancelled_qty, 0)) as net_sold,
  COUNT(DISTINCT order_id) as order_count,
  ROUND(AVG(price_dkk), 2) as avg_price,
  MAX(refund_date) as last_refund_date
FROM skus
GROUP BY shop, sku, product_title, variant_title, created_at, country;

-- ============================================
-- STEP 4: VERIFY THE CHANGE
-- ============================================

-- Check the updated structure
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'skus'
  AND column_name IN ('quantity', 'refunded_qty', 'cancelled_qty')
ORDER BY ordinal_position;

-- Sample data with the new column
SELECT
  sku,
  quantity,
  refunded_qty,
  cancelled_qty,
  quantity - COALESCE(refunded_qty, 0) - COALESCE(cancelled_qty, 0) as net_sold
FROM skus
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
LIMIT 10;

-- ============================================
-- STEP 5: UPDATE SYNC CODE (MANUAL)
-- ============================================

-- NOTE: After running this SQL, you need to update the sync-shop.js file
-- to populate cancelled_qty when syncing SKU data from Shopify.
-- The field should be calculated from order line items that have been cancelled.

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- 1. Run STEP 1 to check if column exists
-- 2. Run STEP 2 to add the cancelled_qty column
-- 3. Run STEP 3 to update the view
-- 4. Run STEP 4 to verify the change
-- 5. Update sync-shop.js to populate cancelled_qty data