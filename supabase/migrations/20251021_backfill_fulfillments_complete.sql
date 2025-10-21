-- Backfill fulfillments table with shop column and refund data

-- STEP 1: Backfill shop column from orders table
UPDATE fulfillments f
SET shop = o.shop
FROM orders o
WHERE f.order_id = o.order_id
  AND f.shop IS NULL;

-- STEP 2: Backfill refund data from SKUs table
WITH refund_aggregates AS (
  SELECT
    s.order_id,
    SUM(s.refunded_qty) AS total_refunded_qty,
    MAX(s.refund_date) AS latest_refund_date
  FROM skus s
  WHERE s.refund_date IS NOT NULL
  GROUP BY s.order_id
)
UPDATE fulfillments f
SET
  refunded_qty = COALESCE(ra.total_refunded_qty, 0),
  refund_date = ra.latest_refund_date
FROM refund_aggregates ra
WHERE f.order_id = ra.order_id
  AND (f.refunded_qty IS NULL OR f.refunded_qty != ra.total_refunded_qty OR f.refund_date != ra.latest_refund_date);

-- Show results
SELECT
  'Fulfillments med shop' AS metric,
  COUNT(*) AS count
FROM fulfillments
WHERE shop IS NOT NULL
UNION ALL
SELECT
  'Fulfillments med refunds' AS metric,
  COUNT(*) AS count
FROM fulfillments
WHERE refunded_qty > 0;
