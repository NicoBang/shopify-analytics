-- Fix: Count refunds by refund_date instead of created_at
-- Batched version: Process one month at a time to avoid timeout

-- September 2024
DO $
DECLARE
  processing_date DATE;
  start_date DATE := '2024-09-01';
  end_date DATE := '2024-09-30';
  rows_affected INTEGER;
BEGIN
  RAISE NOTICE 'Processing September 2024...';

  processing_date := start_date;

  WHILE processing_date <= end_date LOOP
    DELETE FROM daily_shop_metrics WHERE metric_date = processing_date;

    WITH daily_data AS (
      SELECT
        s.shop,
        (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        COUNT(DISTINCT s.order_id) AS order_count,
        SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0)) AS revenue_gross,
        SUM(sb.discount_per_unit_dkk * sb.quantity) AS order_discount_total,
        SUM(sb.sale_discount_per_unit_dkk * sb.quantity) AS sale_discount_total,
        SUM((sb.discount_per_unit_dkk + sb.sale_discount_per_unit_dkk) * sb.quantity) AS total_discounts,
        SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0) - (sb.discount_per_unit_dkk * sb.quantity)) AS revenue_net,
        SUM(sb.quantity) AS sku_quantity_gross,
        SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0)) AS sku_quantity_net,
        SUM(COALESCE(sb.cancelled_qty, 0)) AS cancelled_quantity,
        SUM(COALESCE(sb.cancelled_amount_dkk, 0)) AS cancelled_amount
      FROM orders s
      JOIN skus sb ON s.shop = sb.shop AND s.order_id = sb.order_id
      WHERE (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY s.shop, metric_date
    ),
    refund_data AS (
      SELECT
        sb.shop,
        (sb.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        COUNT(DISTINCT sb.order_id) AS return_order_count,
        SUM(COALESCE(sb.refunded_qty, 0)) AS return_quantity,
        SUM(COALESCE(sb.refunded_amount_dkk, 0)) AS return_amount
      FROM skus sb
      WHERE sb.refund_date IS NOT NULL
        AND (sb.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY sb.shop, metric_date
    ),
    shipping_data AS (
      SELECT
        s.shop,
        (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        SUM(COALESCE(s.shipping_price_dkk, 0)) AS shipping_revenue,
        SUM(COALESCE(s.shipping_discount_dkk, 0)) AS shipping_discount,
        SUM(COALESCE(s.shipping_refund_dkk, 0)) AS shipping_refund
      FROM orders s
      WHERE (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY s.shop, metric_date
    )
    INSERT INTO daily_shop_metrics (
      shop, metric_date, order_count, revenue_gross, revenue_net,
      sku_quantity_gross, sku_quantity_net, return_quantity, return_amount,
      return_order_count, cancelled_quantity, cancelled_amount,
      shipping_revenue, shipping_discount, shipping_refund,
      order_discount_total, sale_discount_total, total_discounts
    )
    SELECT
      COALESCE(d.shop, r.shop, sh.shop) AS shop,
      processing_date AS metric_date,
      COALESCE(d.order_count, 0), COALESCE(d.revenue_gross, 0), COALESCE(d.revenue_net, 0),
      COALESCE(d.sku_quantity_gross, 0), COALESCE(d.sku_quantity_net, 0),
      COALESCE(r.return_quantity, 0), COALESCE(r.return_amount, 0), COALESCE(r.return_order_count, 0),
      COALESCE(d.cancelled_quantity, 0), COALESCE(d.cancelled_amount, 0),
      COALESCE(sh.shipping_revenue, 0), COALESCE(sh.shipping_discount, 0), COALESCE(sh.shipping_refund, 0),
      COALESCE(d.order_discount_total, 0), COALESCE(d.sale_discount_total, 0), COALESCE(d.total_discounts, 0)
    FROM daily_data d
    FULL OUTER JOIN refund_data r ON d.shop = r.shop AND d.metric_date = r.metric_date
    FULL OUTER JOIN shipping_data sh ON COALESCE(d.shop, r.shop) = sh.shop AND processing_date = sh.metric_date;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE 'September 2024 completed';
END $;

-- October 2024
DO $
DECLARE
  processing_date DATE;
  start_date DATE := '2024-10-01';
  end_date DATE := '2024-10-31';
BEGIN
  RAISE NOTICE 'Processing October 2024...';

  processing_date := start_date;

  WHILE processing_date <= end_date LOOP
    DELETE FROM daily_shop_metrics WHERE metric_date = processing_date;

    WITH daily_data AS (
      SELECT s.shop, (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        COUNT(DISTINCT s.order_id) AS order_count,
        SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0)) AS revenue_gross,
        SUM(sb.discount_per_unit_dkk * sb.quantity) AS order_discount_total,
        SUM(sb.sale_discount_per_unit_dkk * sb.quantity) AS sale_discount_total,
        SUM((sb.discount_per_unit_dkk + sb.sale_discount_per_unit_dkk) * sb.quantity) AS total_discounts,
        SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0) - (sb.discount_per_unit_dkk * sb.quantity)) AS revenue_net,
        SUM(sb.quantity) AS sku_quantity_gross,
        SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0)) AS sku_quantity_net,
        SUM(COALESCE(sb.cancelled_qty, 0)) AS cancelled_quantity,
        SUM(COALESCE(sb.cancelled_amount_dkk, 0)) AS cancelled_amount
      FROM orders s JOIN skus sb ON s.shop = sb.shop AND s.order_id = sb.order_id
      WHERE (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY s.shop, metric_date
    ),
    refund_data AS (
      SELECT sb.shop, (sb.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        COUNT(DISTINCT sb.order_id) AS return_order_count,
        SUM(COALESCE(sb.refunded_qty, 0)) AS return_quantity,
        SUM(COALESCE(sb.refunded_amount_dkk, 0)) AS return_amount
      FROM skus sb
      WHERE sb.refund_date IS NOT NULL AND (sb.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY sb.shop, metric_date
    ),
    shipping_data AS (
      SELECT s.shop, (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS metric_date,
        SUM(COALESCE(s.shipping_price_dkk, 0)) AS shipping_revenue,
        SUM(COALESCE(s.shipping_discount_dkk, 0)) AS shipping_discount,
        SUM(COALESCE(s.shipping_refund_dkk, 0)) AS shipping_refund
      FROM orders s WHERE (s.created_at AT TIME ZONE 'Europe/Copenhagen')::date = processing_date
      GROUP BY s.shop, metric_date
    )
    INSERT INTO daily_shop_metrics (
      shop, metric_date, order_count, revenue_gross, revenue_net,
      sku_quantity_gross, sku_quantity_net, return_quantity, return_amount,
      return_order_count, cancelled_quantity, cancelled_amount,
      shipping_revenue, shipping_discount, shipping_refund,
      order_discount_total, sale_discount_total, total_discounts
    )
    SELECT COALESCE(d.shop, r.shop, sh.shop), processing_date,
      COALESCE(d.order_count, 0), COALESCE(d.revenue_gross, 0), COALESCE(d.revenue_net, 0),
      COALESCE(d.sku_quantity_gross, 0), COALESCE(d.sku_quantity_net, 0),
      COALESCE(r.return_quantity, 0), COALESCE(r.return_amount, 0), COALESCE(r.return_order_count, 0),
      COALESCE(d.cancelled_quantity, 0), COALESCE(d.cancelled_amount, 0),
      COALESCE(sh.shipping_revenue, 0), COALESCE(sh.shipping_discount, 0), COALESCE(sh.shipping_refund, 0),
      COALESCE(d.order_discount_total, 0), COALESCE(d.sale_discount_total, 0), COALESCE(d.total_discounts, 0)
    FROM daily_data d
    FULL OUTER JOIN refund_data r ON d.shop = r.shop AND d.metric_date = r.metric_date
    FULL OUTER JOIN shipping_data sh ON COALESCE(d.shop, r.shop) = sh.shop AND processing_date = sh.metric_date;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE 'October 2024 completed';
END $;

-- Continue for remaining months (copy pattern above for each month through October 2025)
-- You can run additional months separately if needed
