-- Migration: Backfill refund_date for cancelled items in skus table
-- Purpose: Set refund_date for all SKUs with cancelled_qty > 0 but refund_date IS NULL
-- Strategy:
--   1. Try to get refund date from orders.refund_date (most accurate)
--   2. Fallback to orders.cancelled_at if order was cancelled
--   3. Fallback to orders.updated_at as last resort
--
-- Date: 2025-10-08
-- Author: Claude (via Nicolai)

-- Step 1: Update cancelled items using orders.refund_date (primary source)
UPDATE skus
SET refund_date = orders.refund_date
FROM orders
WHERE skus.shop = orders.shop
  AND skus.order_id = orders.order_id
  AND skus.cancelled_qty > 0
  AND skus.refund_date IS NULL
  AND orders.refund_date IS NOT NULL;

-- Step 2: Update remaining cancelled items using orders.cancelled_at (fallback for fully cancelled orders)
UPDATE skus
SET refund_date = orders.cancelled_at
FROM orders
WHERE skus.shop = orders.shop
  AND skus.order_id = orders.order_id
  AND skus.cancelled_qty > 0
  AND skus.refund_date IS NULL
  AND orders.cancelled_at IS NOT NULL;

-- Step 3: Update remaining cancelled items using orders.updated_at (last resort fallback)
UPDATE skus
SET refund_date = orders.updated_at
FROM orders
WHERE skus.shop = orders.shop
  AND skus.order_id = orders.order_id
  AND skus.cancelled_qty > 0
  AND skus.refund_date IS NULL
  AND orders.updated_at IS NOT NULL;

-- Verification query: Check how many cancelled items still have NULL refund_date
-- (Should be 0 after this migration)
SELECT
  shop,
  COUNT(*) as cancelled_items_without_refund_date
FROM skus
WHERE cancelled_qty > 0
  AND refund_date IS NULL
GROUP BY shop
ORDER BY shop;

-- Summary query: Show distribution of refund_date sources
SELECT
  'Total cancelled items' as metric,
  COUNT(*) as count
FROM skus
WHERE cancelled_qty > 0
UNION ALL
SELECT
  'Cancelled items with refund_date' as metric,
  COUNT(*) as count
FROM skus
WHERE cancelled_qty > 0
  AND refund_date IS NOT NULL
UNION ALL
SELECT
  'Cancelled items WITHOUT refund_date' as metric,
  COUNT(*) as count
FROM skus
WHERE cancelled_qty > 0
  AND refund_date IS NULL;
