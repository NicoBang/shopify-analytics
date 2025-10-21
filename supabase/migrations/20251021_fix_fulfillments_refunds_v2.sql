-- Fix fulfillments refund data - Version 2
-- Problem: Multiple fulfillments per order all get same total refunded_qty
-- Solution: Only keep refund data on ONE fulfillment per order (the latest one)

-- STEP 1: Clear ALL refund data
UPDATE fulfillments
SET refunded_qty = 0, refund_date = NULL
WHERE refunded_qty > 0 OR refund_date IS NOT NULL;

-- STEP 2: Update ONLY the latest fulfillment per order
WITH refund_aggregates AS (
  SELECT
    s.order_id,
    SUM(s.refunded_qty) AS total_refunded_qty,
    MAX(s.refund_date) AS latest_refund_date
  FROM skus s
  WHERE s.refund_date IS NOT NULL
  GROUP BY s.order_id
),
ranked_fulfillments AS (
  SELECT
    f.id,
    f.order_id,
    ROW_NUMBER() OVER (
      PARTITION BY f.order_id
      ORDER BY f.date DESC NULLS LAST, f.created_at DESC
    ) AS rn
  FROM fulfillments f
  WHERE f.order_id IN (SELECT order_id FROM refund_aggregates)
),
latest_fulfillments AS (
  SELECT id, order_id
  FROM ranked_fulfillments
  WHERE rn = 1
)
UPDATE fulfillments f
SET
  refunded_qty = ra.total_refunded_qty,
  refund_date = ra.latest_refund_date
FROM refund_aggregates ra
JOIN latest_fulfillments lf ON lf.order_id = ra.order_id
WHERE f.id = lf.id;

-- STEP 3: Verify results
SELECT
  'Total refunded_qty (should be 20)' AS check_type,
  SUM(refunded_qty)::text AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00'
UNION ALL
SELECT
  'Antal fulfillments med refunds' AS check_type,
  COUNT(*)::text AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00'
UNION ALL
SELECT
  'Antal unikke ordrer med refunds' AS check_type,
  COUNT(DISTINCT order_id)::text AS value
FROM fulfillments
WHERE refund_date >= '2025-09-10T22:00:00+00'
  AND refund_date < '2025-09-11T22:00:00+00'
UNION ALL
SELECT
  'Duplikater (should be 0)' AS check_type,
  COUNT(*)::text AS value
FROM (
  SELECT order_id, COUNT(*) as cnt
  FROM fulfillments
  WHERE refund_date >= '2025-09-10T22:00:00+00'
    AND refund_date < '2025-09-11T22:00:00+00'
  GROUP BY order_id
  HAVING COUNT(*) > 1
) duplicates;
