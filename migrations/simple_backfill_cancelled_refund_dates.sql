-- Simple Migration: Use SKU's own dates to backfill refund_date for cancelled items
-- No need to join with orders table - all data we need is in skus table
-- Date: 2025-10-08

-- Strategy: For cancelled items without refund_date, use the SKU's created_at date
-- This represents when the order (and cancellation) was created/processed

UPDATE skus
SET refund_date = created_at
WHERE cancelled_qty > 0
  AND refund_date IS NULL;

-- Verification: Check if any cancelled items still lack refund_date
SELECT
  shop,
  COUNT(*) as remaining_cancelled_items_without_refund_date
FROM skus
WHERE cancelled_qty > 0
  AND refund_date IS NULL
GROUP BY shop
ORDER BY shop;

-- Summary: Show total cancelled items with refund_date
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
