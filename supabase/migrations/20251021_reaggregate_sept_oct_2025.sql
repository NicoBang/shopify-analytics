-- Re-aggregate daily_shop_metrics for 2025-09-30 to 2025-10-05
-- This fixes the cancelled_amount bug by recalculating all metrics
--
-- Bug Fix: Previously metrics showed incorrect cancelled_amount due to old data
-- Now recalculating with correct logic from aggregate-daily-metrics function

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
    s.discount_per_unit_dkk,
    s.sale_discount_per_unit_dkk,
    s.refunded_qty,
    s.refunded_amount_dkk
  FROM skus s
  WHERE (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN '2025-09-30' AND '2025-10-05'
),

-- 2️⃣ Aggregate sales by shop and date
sales AS (
  SELECT
    sb.shop,
    sb.created_date_dk AS metric_date,
    COUNT(DISTINCT sb.order_id) AS order_count,
    -- Quantities
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0)) AS sku_quantity_gross,
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0) - COALESCE(sb.refunded_qty, 0)) AS sku_quantity_net,
    SUM(COALESCE(sb.refunded_qty, 0)) AS return_quantity,
    SUM(COALESCE(sb.cancelled_qty, 0)) AS cancelled_quantity,
    -- Revenue calculations
    SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0)) AS revenue_gross,
    SUM(COALESCE(sb.refunded_amount_dkk, 0)) AS return_amount,
    SUM(COALESCE(sb.cancelled_amount_dkk, 0)) AS cancelled_amount,
    -- Separate discount types
    SUM(sb.discount_per_unit_dkk * sb.quantity) AS order_discount_total,
    SUM(sb.sale_discount_per_unit_dkk * sb.quantity) AS sale_discount_total,
    SUM((sb.discount_per_unit_dkk + sb.sale_discount_per_unit_dkk) * sb.quantity) AS total_discounts
  FROM sales_base sb
  GROUP BY sb.shop, sb.created_date_dk
),

-- 3️⃣ Calculate revenue_net and bruttoomsætning
sales_with_net AS (
  SELECT
    shop,
    metric_date,
    order_count,
    sku_quantity_gross,
    sku_quantity_net,
    return_quantity,
    cancelled_quantity,
    revenue_gross,
    revenue_gross - return_amount AS revenue_net,
    return_amount,
    cancelled_amount,
    order_discount_total,
    sale_discount_total,
    total_discounts
  FROM sales
),

-- 4️⃣ Get shipping metrics (based on created_at with Danish timezone)
shipping AS (
  SELECT
    o.shop,
    (o.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
    SUM(COALESCE(o.shipping_price_dkk, 0)) AS shipping_revenue,
    SUM(COALESCE(o.shipping_discount_dkk, 0)) AS shipping_discount
  FROM orders o
  WHERE (o.created_at AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN '2025-09-30' AND '2025-10-05'
  GROUP BY o.shop, (o.created_at AT TIME ZONE 'Europe/Copenhagen')::date
),

-- 5️⃣ Get shipping refunds (based on refund_date with Danish timezone)
shipping_refunds AS (
  SELECT
    o.shop,
    (o.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
    SUM(COALESCE(o.shipping_refund_dkk, 0)) AS shipping_refund
  FROM orders o
  WHERE o.shipping_refund_dkk > 0
    AND (o.refund_date AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN '2025-09-30' AND '2025-10-05'
  GROUP BY o.shop, (o.refund_date AT TIME ZONE 'Europe/Copenhagen')::date
),

-- 6️⃣ Get refund counts (based on refund_date)
refund_orders AS (
  SELECT
    s.shop,
    (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
    COUNT(DISTINCT s.order_id) AS return_order_count
  FROM skus s
  WHERE s.refunded_qty > 0
    AND s.cancelled_qty = 0
    AND (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date BETWEEN '2025-09-30' AND '2025-10-05'
  GROUP BY s.shop, (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date
)

-- 7️⃣ Combine all metrics and upsert
INSERT INTO daily_shop_metrics (
  shop, metric_date, order_count,
  sku_quantity_gross, sku_quantity_net, return_quantity, cancelled_quantity,
  revenue_gross, revenue_net, return_amount, cancelled_amount,
  order_discount_total, sale_discount_total, total_discounts,
  shipping_revenue, shipping_discount, shipping_refund, return_order_count
)
SELECT
  COALESCE(s.shop, sh.shop, sr.shop, ro.shop) AS shop,
  COALESCE(s.metric_date, sh.metric_date, sr.metric_date, ro.metric_date) AS metric_date,
  COALESCE(s.order_count, 0) AS order_count,
  COALESCE(s.sku_quantity_gross, 0) AS sku_quantity_gross,
  COALESCE(s.sku_quantity_net, 0) AS sku_quantity_net,
  COALESCE(s.return_quantity, 0) AS return_quantity,
  COALESCE(s.cancelled_quantity, 0) AS cancelled_quantity,
  ROUND(COALESCE(s.revenue_gross, 0)::numeric, 2) AS revenue_gross,
  ROUND(COALESCE(s.revenue_net, 0)::numeric, 2) AS revenue_net,
  ROUND(COALESCE(s.return_amount, 0)::numeric, 2) AS return_amount,
  ROUND(COALESCE(s.cancelled_amount, 0)::numeric, 2) AS cancelled_amount,
  ROUND(COALESCE(s.order_discount_total, 0)::numeric, 2) AS order_discount_total,
  ROUND(COALESCE(s.sale_discount_total, 0)::numeric, 2) AS sale_discount_total,
  ROUND(COALESCE(s.total_discounts, 0)::numeric, 2) AS total_discounts,
  ROUND(COALESCE(sh.shipping_revenue, 0)::numeric, 2) AS shipping_revenue,
  ROUND(COALESCE(sh.shipping_discount, 0)::numeric, 2) AS shipping_discount,
  ROUND(COALESCE(sr.shipping_refund, 0)::numeric, 2) AS shipping_refund,
  COALESCE(ro.return_order_count, 0) AS return_order_count
FROM sales_with_net s
FULL OUTER JOIN shipping sh ON s.shop = sh.shop AND s.metric_date = sh.metric_date
FULL OUTER JOIN shipping_refunds sr ON COALESCE(s.shop, sh.shop) = sr.shop AND COALESCE(s.metric_date, sh.metric_date) = sr.metric_date
FULL OUTER JOIN refund_orders ro ON COALESCE(s.shop, sh.shop, sr.shop) = ro.shop AND COALESCE(s.metric_date, sh.metric_date, sr.metric_date) = ro.metric_date
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
  order_discount_total = EXCLUDED.order_discount_total,
  sale_discount_total = EXCLUDED.sale_discount_total,
  total_discounts = EXCLUDED.total_discounts,
  shipping_revenue = EXCLUDED.shipping_revenue,
  shipping_discount = EXCLUDED.shipping_discount,
  shipping_refund = EXCLUDED.shipping_refund,
  return_order_count = EXCLUDED.return_order_count,
  updated_at = NOW();
