-- Backfill daily_shop_metrics with CORRECT refund date handling
-- CRITICAL FIX: Refunds must be aggregated by refund_date, NOT created_at_original
--
-- Calculation Logic:
-- - Sales metrics: Aggregate by created_at_original (order date)
-- - Refund metrics: Aggregate by refund_date (return date)
-- - Join both on metric_date to get complete daily picture

WITH
-- 1️⃣ Sales data (based on created_at_original with Danish timezone)
sales_base AS (
  SELECT
    s.shop,
    s.order_id,
    (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
    s.quantity,
    s.cancelled_qty,
    s.price_dkk,
    s.cancelled_amount_dkk,
    s.discount_per_unit_dkk
  FROM skus s
),

-- 2️⃣ Refund data (based on refund_date with Danish timezone)
refunds_base AS (
  SELECT
    s.shop,
    (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
    s.refunded_qty,
    s.refunded_amount_dkk
  FROM skus s
  WHERE s.refund_date IS NOT NULL
),

-- 3️⃣ Aggregate sales by shop and date
sales AS (
  SELECT
    sb.shop,
    sb.created_date_dk AS metric_date,
    COUNT(DISTINCT sb.order_id) AS order_count,
    -- Quantities (INCLUDE cancelled items)
    SUM(sb.quantity) AS sku_quantity_gross,
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0)) AS sku_quantity_net_before_refunds,
    SUM(COALESCE(sb.cancelled_qty, 0)) AS cancelled_quantity,
    -- Revenue calculations (INCLUDE cancelled items)
    SUM((sb.price_dkk * sb.quantity)) AS revenue_gross,
    SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0))) AS cancelled_amount,
    SUM((sb.discount_per_unit_dkk * sb.quantity)) AS total_discounts
  FROM sales_base sb
  GROUP BY sb.shop, sb.created_date_dk
),

-- 4️⃣ Aggregate refunds by shop and refund date
refunds AS (
  SELECT
    rb.shop,
    rb.refund_date_dk AS metric_date,
    SUM(COALESCE(rb.refunded_qty, 0)) AS return_quantity,
    SUM(COALESCE(rb.refunded_amount_dkk, 0)) AS return_amount
  FROM refunds_base rb
  GROUP BY rb.shop, rb.refund_date_dk
),

-- 5️⃣ Join sales and refunds on metric_date
joined AS (
  SELECT
    COALESCE(s.shop, r.shop) AS shop,
    COALESCE(s.metric_date, r.metric_date) AS metric_date,
    COALESCE(s.order_count, 0) AS order_count,
    COALESCE(s.sku_quantity_gross, 0) AS sku_quantity_gross,
    COALESCE(s.sku_quantity_net_before_refunds, 0) - COALESCE(r.return_quantity, 0) AS sku_quantity_net,
    COALESCE(r.return_quantity, 0) AS return_quantity,
    COALESCE(s.cancelled_quantity, 0) AS cancelled_quantity,
    COALESCE(s.revenue_gross, 0) AS revenue_gross,
    COALESCE(s.revenue_gross, 0) - COALESCE(s.total_discounts, 0) - COALESCE(s.cancelled_amount, 0) AS revenue_net,
    COALESCE(r.return_amount, 0) AS return_amount,
    COALESCE(s.cancelled_amount, 0) AS cancelled_amount,
    COALESCE(s.total_discounts, 0) AS total_discounts
  FROM sales s
  FULL OUTER JOIN refunds r ON s.shop = r.shop AND s.metric_date = r.metric_date
)

INSERT INTO daily_shop_metrics (
  shop, metric_date, order_count,
  sku_quantity_gross, sku_quantity_net, return_quantity, cancelled_quantity,
  revenue_gross, revenue_net, return_amount, cancelled_amount, total_discounts
)
SELECT
  shop, metric_date, order_count,
  sku_quantity_gross, sku_quantity_net, return_quantity, cancelled_quantity,
  revenue_gross, revenue_net, return_amount, cancelled_amount, total_discounts
FROM joined
ON CONFLICT (shop, metric_date)
DO UPDATE SET
  order_count = EXCLUDED.order_count,
  sku_quantity_gross = EXCLUDED.sku_quantity_gross,
  sku_quantity_net = EXCLUDED.sku_quantity_net,
  return_quantity = EXCLUDED.return_quantity,
  cancelled_quantity = EXCLUDED.cancelled_quantity,
  revenue_gross = EXCLUDED.revenue_gross,
  revenue_net = EXCLUDED.revenue_net,
  return_amount = EXCLUDED.return_amount,
  cancelled_amount = EXCLUDED.cancelled_amount,
  total_discounts = EXCLUDED.total_discounts,
  updated_at = NOW();
