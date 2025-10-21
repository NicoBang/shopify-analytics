-- Fix: Count refunds by refund_date instead of created_at_original
-- This ensures refunds are counted in the period they actually happened
-- NOT in the period the original order was created

-- Re-aggregate ALL historical data with correct refund counting logic
-- This will take ~2-5 minutes for full historical data

DO $$
DECLARE
  processing_date DATE;
  start_date DATE := '2024-09-01'; -- Adjust to your earliest data date
  end_date DATE := CURRENT_DATE;
  rows_affected INTEGER;
BEGIN
  RAISE NOTICE 'Starting historical re-aggregation from % to %', start_date, end_date;

  processing_date := start_date;

  WHILE processing_date <= end_date LOOP
    -- Delete existing metrics for this date to force re-calculation
    DELETE FROM daily_shop_metrics WHERE metric_date = processing_date;

    -- Re-aggregate with CORRECT refund_date logic
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

    -- ✅ CRITICAL FIX: Count refunds by refund_date, NOT created_at_original
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
      shop,
      metric_date,
      order_count,
      revenue_gross,
      revenue_net,
      sku_quantity_gross,
      sku_quantity_net,
      return_quantity,
      return_amount,
      return_order_count,
      cancelled_quantity,
      cancelled_amount,
      shipping_revenue,
      shipping_discount,
      shipping_refund,
      order_discount_total,
      sale_discount_total,
      total_discounts
    )
    SELECT
      COALESCE(d.shop, r.shop, sh.shop) AS shop,
      processing_date AS metric_date,
      COALESCE(d.order_count, 0) AS order_count,
      COALESCE(d.revenue_gross, 0) AS revenue_gross,
      COALESCE(d.revenue_net, 0) AS revenue_net,
      COALESCE(d.sku_quantity_gross, 0) AS sku_quantity_gross,
      COALESCE(d.sku_quantity_net, 0) AS sku_quantity_net,
      COALESCE(r.return_quantity, 0) AS return_quantity,
      COALESCE(r.return_amount, 0) AS return_amount,
      COALESCE(r.return_order_count, 0) AS return_order_count,
      COALESCE(d.cancelled_quantity, 0) AS cancelled_quantity,
      COALESCE(d.cancelled_amount, 0) AS cancelled_amount,
      COALESCE(sh.shipping_revenue, 0) AS shipping_revenue,
      COALESCE(sh.shipping_discount, 0) AS shipping_discount,
      COALESCE(sh.shipping_refund, 0) AS shipping_refund,
      COALESCE(d.order_discount_total, 0) AS order_discount_total,
      COALESCE(d.sale_discount_total, 0) AS sale_discount_total,
      COALESCE(d.total_discounts, 0) AS total_discounts
    FROM daily_data d
    FULL OUTER JOIN refund_data r ON d.shop = r.shop AND d.metric_date = r.metric_date
    FULL OUTER JOIN shipping_data sh ON COALESCE(d.shop, r.shop) = sh.shop AND processing_date = sh.metric_date;

    GET DIAGNOSTICS rows_affected = ROW_COUNT;

    -- Log progress every 10 days
    IF (processing_date - start_date) % 10 = 0 THEN
      RAISE NOTICE 'Processed % - % rows inserted', processing_date, rows_affected;
    END IF;

    processing_date := processing_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE 'Historical re-aggregation completed successfully';
END $$;
