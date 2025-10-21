-- Backfill daily_shop_metrics with CORRECTED logic
-- This script fixes quantity and revenue calculation to include cancelled items
--
-- Calculation Logic:
-- - sku_quantity_gross = SUM(quantity) - INCLUDE cancelled items
-- - revenue_gross = SUM(price_dkk * quantity) - INCLUDE cancelled items
-- - revenue_net = revenue_gross - total_discounts - cancelled_amount
-- - total_discounts = SUM(discount_per_unit_dkk * quantity)

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
    s.refunded_qty,
    s.refunded_amount_dkk
  FROM skus s
),

-- 2️⃣ Aggregate sales by shop and date
sales AS (
  SELECT
    sb.shop,
    sb.created_date_dk AS metric_date,
    COUNT(DISTINCT sb.order_id) AS order_count,
    -- Quantities (INCLUDE cancelled items)
    SUM(sb.quantity) AS sku_quantity_gross,
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0) - COALESCE(sb.refunded_qty, 0)) AS sku_quantity_net,
    SUM(COALESCE(sb.refunded_qty, 0)) AS return_quantity,
    SUM(COALESCE(sb.cancelled_qty, 0)) AS cancelled_quantity,
    -- Revenue calculations (INCLUDE cancelled items)
    SUM((sb.price_dkk * sb.quantity)) AS revenue_gross,
    SUM((sb.price_dkk * sb.quantity)) - SUM((sb.discount_per_unit_dkk * sb.quantity)) - SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0))) AS revenue_net,
    SUM(COALESCE(sb.refunded_amount_dkk, 0)) AS return_amount,
    SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0))) AS cancelled_amount,
    SUM((sb.discount_per_unit_dkk * sb.quantity)) AS total_discounts
  FROM sales_base sb
  GROUP BY sb.shop, sb.created_date_dk
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
FROM sales
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
