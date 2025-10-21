-- Fix fulfillments refund data
-- Problem: Multiple fulfillments per order all get same total refunded_qty
-- Solution: Only update the LATEST fulfillment per order with refund data

-- STEP 1: Clear refund data from ALL fulfillments
UPDATE fulfillments
SET refunded_qty = 0, refund_date = NULL
WHERE refunded_qty > 0;

-- STEP 2: Update ONLY the latest fulfillment per order with refund totals
WITH refund_aggregates AS (
  SELECT
    s.order_id,
    SUM(s.refunded_qty) AS total_refunded_qty,
    MAX(s.refund_date) AS latest_refund_date
  FROM skus s
  WHERE s.refund_date IS NOT NULL
  GROUP BY s.order_id
),
latest_fulfillments AS (
  SELECT DISTINCT ON (order_id)
    id,
    order_id
  FROM fulfillments
  WHERE order_id IN (SELECT order_id FROM refund_aggregates)
  ORDER BY order_id, date DESC, created_at DESC
)
UPDATE fulfillments f
SET
  refunded_qty = ra.total_refunded_qty,
  refund_date = ra.latest_refund_date
FROM refund_aggregates ra
JOIN latest_fulfillments lf ON lf.order_id = ra.order_id
WHERE f.id = lf.id;

-- Verify results
SELECT
  'Total refunded_qty (should be 20)' AS check_type,
  SUM(refunded_qty) AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00'
UNION ALL
SELECT
  'Antal fulfillments med refunds' AS check_type,
  COUNT(*) AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00'
UNION ALL
SELECT
  'Antal unikke ordrer med refunds' AS check_type,
  COUNT(DISTINCT order_id) AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00';
