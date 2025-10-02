-- Fix cancelled_qty for 2024 data (Sept 30 - Oct 6)
-- This SQL script calculates cancelled_qty from orders table and updates skus table

-- Step 1: Create a temporary table with order-level cancelled_qty
CREATE TEMP TABLE order_cancelled_totals AS
SELECT
  order_id,
  cancelled_qty as order_cancelled_qty,
  item_count as order_item_count
FROM orders
WHERE created_at >= '2024-09-30T00:00:00Z'
  AND created_at <= '2024-10-06T23:59:59Z'
  AND cancelled_qty > 0;

-- Step 2: Update skus table with proportionally allocated cancelled_qty
UPDATE skus s
SET cancelled_qty = ROUND(
  (s.quantity::numeric / oct.order_item_count::numeric) * oct.order_cancelled_qty::numeric
)::integer
FROM order_cancelled_totals oct
WHERE s.order_id = oct.order_id
  AND s.created_at >= '2024-09-30T00:00:00Z'
  AND s.created_at <= '2024-10-06T23:59:59Z';

-- Step 3: Verify the results
SELECT
  'Orders with cancelled items' as metric,
  COUNT(DISTINCT order_id) as count
FROM order_cancelled_totals
UNION ALL
SELECT
  'SKUs updated with cancelled_qty',
  COUNT(*)
FROM skus
WHERE created_at >= '2024-09-30T00:00:00Z'
  AND created_at <= '2024-10-06T23:59:59Z'
  AND cancelled_qty > 0
UNION ALL
SELECT
  'Total cancelled quantity',
  SUM(cancelled_qty)
FROM skus
WHERE created_at >= '2024-09-30T00:00:00Z'
  AND created_at <= '2024-10-06T23:59:59Z';

-- Step 4: Show sample results for verification
SELECT
  order_id,
  sku,
  quantity,
  cancelled_qty,
  quantity - cancelled_qty as net_quantity
FROM skus
WHERE created_at >= '2024-09-30T00:00:00Z'
  AND created_at <= '2024-10-06T23:59:59Z'
  AND cancelled_qty > 0
ORDER BY created_at DESC
LIMIT 20;
