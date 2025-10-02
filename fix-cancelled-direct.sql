-- Direct SQL fix for 2024 cancelled_qty
-- Run this directly in Supabase SQL Editor

-- Step 1: Update SKUs with cancelled_qty from orders table
UPDATE skus s
SET cancelled_qty = ROUND(
  (s.quantity::numeric / o.item_count::numeric) * o.cancelled_qty::numeric
)::integer
FROM orders o
WHERE s.order_id = o.order_id
  AND s.created_at::date >= '2024-09-30'::date
  AND s.created_at::date <= '2024-10-06'::date
  AND o.cancelled_qty > 0;

-- Step 2: Verify results
SELECT
  'Orders with cancellations' as metric,
  COUNT(DISTINCT o.order_id)::text as value
FROM orders o
WHERE o.created_at::date >= '2024-09-30'::date
  AND o.created_at::date <= '2024-10-06'::date
  AND o.cancelled_qty > 0

UNION ALL

SELECT
  'SKUs updated',
  COUNT(*)::text
FROM skus
WHERE created_at::date >= '2024-09-30'::date
  AND created_at::date <= '2024-10-06'::date
  AND cancelled_qty > 0

UNION ALL

SELECT
  'Total cancelled_qty',
  SUM(cancelled_qty)::text
FROM skus
WHERE created_at::date >= '2024-09-30'::date
  AND created_at::date <= '2024-10-06'::date;
