-- Fix cancelled_qty and cancelled_amount in color and SKU metrics
-- Problem: solgt = SUM(quantity) includes cancelled items
-- Problem: omsaetning_net includes cancelled_amount
-- Solution: solgt = SUM(quantity - cancelled_qty), omsaetning_net excludes cancelled_amount

-- ============================================================================
-- 1. Fix aggregate_color_metrics_for_date()
-- ============================================================================
CREATE OR REPLACE FUNCTION aggregate_color_metrics_for_date(target_date DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WITH
  -- 1️⃣ Sales data (based on created_at_original with Danish timezone)
  sales_base AS (
    SELECT
      s.shop,
      s.order_id,
      s.sku,
      (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
      s.quantity,
      s.cancelled_qty,
      s.price_dkk,
      s.cancelled_amount_dkk,
      s.discount_per_unit_dkk,
      s.sale_discount_per_unit_dkk,
      s.sale_discount_total_dkk,
      s.product_title,
      s.variant_title,
      (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
    FROM skus s
    WHERE (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = target_date
      AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
  ),

  -- 2️⃣ Refund data (based on refund_date with Danish timezone)
  refunds_base AS (
    SELECT
      s.shop,
      s.order_id,
      s.sku,
      (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
      s.refunded_qty,
      s.refunded_amount_dkk,
      (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
    FROM skus s
    WHERE s.refund_date IS NOT NULL
      AND (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = target_date
      AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
  ),

  -- 3️⃣ Get metadata per artikelnummer
  meta AS (
    SELECT DISTINCT ON ((regexp_match(pm.sku, '^(\d+)'))[1])
      (regexp_match(pm.sku, '^(\d+)'))[1] AS artikelnummer,
      pm.program,
      pm.season,
      pm.gender,
      pm.status,
      pm.cost AS kostpris,
      pm.varemodtaget,
      pm.tags,
      GREATEST(COALESCE(pm.price, 0), COALESCE(pm.compare_at_price, 0)) AS vejl_pris
    FROM product_metadata pm
    WHERE (regexp_match(pm.sku, '^(\d+)'))[1] IS NOT NULL
    ORDER BY (regexp_match(pm.sku, '^(\d+)'))[1], pm.sku
  ),

  -- 4️⃣ Parse product titles
  title_parsed AS (
    SELECT DISTINCT ON (artikelnummer)
      artikelnummer,
      split_part(
        CASE WHEN strpos(product_title, '|') > 0
             THEN split_part(product_title, '|', 1)
             ELSE product_title
        END,
        ' - ',
        1
      ) AS produkt,
      CASE
        WHEN strpos(product_title, '|') > 0 THEN
          REVERSE(split_part(REVERSE(split_part(product_title, '|', 1)), ' - ', 1))
        ELSE
          REVERSE(split_part(REVERSE(product_title), ' - ', 1))
      END AS farve
    FROM sales_base
    WHERE product_title IS NOT NULL AND product_title != ''
    ORDER BY artikelnummer, product_title
  ),

  -- 5️⃣ Aggregate sales
  sales AS (
    SELECT
      sb.created_date_dk AS metric_date,
      sb.artikelnummer,
      -- ✅ FIX: solgt = quantity - cancelled_qty (exclude cancelled items)
      SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
      SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
      -- ✅ FIX: revenue_gross excludes cancelled_amount
      SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS revenue_gross,
      SUM(COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS cancelled_amount,
      SUM((sb.discount_per_unit_dkk * sb.quantity))::numeric(14,2) AS order_discounts,
      SUM(sb.sale_discount_total_dkk)::numeric(14,2) AS sale_discounts
    FROM sales_base sb
    GROUP BY sb.created_date_dk, sb.artikelnummer
  ),

  -- 6️⃣ Aggregate refunds
  refunds AS (
    SELECT
      rb.refund_date_dk AS metric_date,
      rb.artikelnummer,
      SUM(COALESCE(rb.refunded_qty, 0))::int AS retur,
      SUM(COALESCE(rb.refunded_amount_dkk, 0))::numeric(14,2) AS refunded_amount
    FROM refunds_base rb
    GROUP BY rb.refund_date_dk, rb.artikelnummer
  ),

  -- 7️⃣ Join all data
  joined AS (
    SELECT
      d.metric_date,
      d.artikelnummer,
      MAX(COALESCE(m.program, '')) AS program,
      MAX(COALESCE(tp.produkt, '')) AS produkt,
      MAX(COALESCE(tp.farve, '')) AS farve,
      MAX(COALESCE(m.season, '')) AS season,
      MAX(COALESCE(m.gender, '')) AS gender,
      SUM(COALESCE(s.solgt, 0)) AS solgt,
      SUM(COALESCE(r.retur, 0)) AS retur,
      SUM(COALESCE(s.cancelled, 0)) AS cancelled,
      -- ✅ omsaetning_net = revenue_gross (already excludes cancelled) - discounts
      SUM(COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0)) AS omsaetning_net,
      SUM(COALESCE(s.cancelled_amount, 0)) AS cancelled_amount,
      SUM(COALESCE(r.refunded_amount, 0)) AS refunded_amount,
      MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
      (MAX(COALESCE(m.kostpris, 0)) * SUM(COALESCE(s.solgt, 0)))::numeric(14,2) AS kostpris,
      MAX(COALESCE(m.status, '')) AS status,
      MAX(COALESCE(m.tags, '')) AS tags,
      MAX(COALESCE(m.vejl_pris, 0))::numeric(14,2) AS vejl_pris
    FROM (
      SELECT metric_date, artikelnummer FROM sales
      UNION
      SELECT metric_date, artikelnummer FROM refunds
    ) d
    LEFT JOIN sales s ON s.metric_date = d.metric_date AND s.artikelnummer = d.artikelnummer
    LEFT JOIN refunds r ON r.metric_date = d.metric_date AND r.artikelnummer = d.artikelnummer
    LEFT JOIN meta m ON m.artikelnummer = d.artikelnummer
    LEFT JOIN title_parsed tp ON tp.artikelnummer = d.artikelnummer
    GROUP BY d.metric_date, d.artikelnummer
  )

  -- 8️⃣ Upsert into daily_color_metrics
  INSERT INTO daily_color_metrics (
    metric_date, artikelnummer, program, produkt, farve, season, gender,
    solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
    varemodtaget, kostpris, status, tags, vejl_pris
  )
  SELECT
    metric_date, artikelnummer, program, produkt, farve, season, gender,
    solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
    varemodtaget, kostpris, status, tags, vejl_pris
  FROM joined
  ON CONFLICT (metric_date, artikelnummer)
  DO UPDATE SET
    program = EXCLUDED.program,
    produkt = EXCLUDED.produkt,
    farve = EXCLUDED.farve,
    season = EXCLUDED.season,
    gender = EXCLUDED.gender,
    solgt = EXCLUDED.solgt,
    retur = EXCLUDED.retur,
    cancelled = EXCLUDED.cancelled,
    omsaetning_net = EXCLUDED.omsaetning_net,
    cancelled_amount = EXCLUDED.cancelled_amount,
    refunded_amount = EXCLUDED.refunded_amount,
    varemodtaget = EXCLUDED.varemodtaget,
    kostpris = EXCLUDED.kostpris,
    status = EXCLUDED.status,
    tags = EXCLUDED.tags,
    vejl_pris = EXCLUDED.vejl_pris;

END;
$$;

-- ============================================================================
-- 2. Fix aggregate_sku_metrics_for_date()
-- ============================================================================
CREATE OR REPLACE FUNCTION aggregate_sku_metrics_for_date(target_date DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WITH
  -- 1️⃣ Sales data (based on created_at_original with Danish timezone)
  sales_base AS (
    SELECT
      s.shop,
      s.order_id,
      s.sku,
      (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
      s.quantity,
      s.cancelled_qty,
      s.price_dkk,
      s.cancelled_amount_dkk,
      s.discount_per_unit_dkk,
      s.sale_discount_per_unit_dkk,
      s.sale_discount_total_dkk,
      s.product_title,
      s.variant_title,
      (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
    FROM skus s
    WHERE (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = target_date
      AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
  ),

  -- 2️⃣ Refund data (based on refund_date with Danish timezone)
  refunds_base AS (
    SELECT
      s.shop,
      s.order_id,
      s.sku,
      (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
      s.refunded_qty,
      s.refunded_amount_dkk,
      (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
    FROM skus s
    WHERE s.refund_date IS NOT NULL
      AND (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = target_date
      AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
  ),

  -- 3️⃣ Get metadata per full SKU
  meta AS (
    SELECT
      pm.sku,
      pm.program,
      pm.season,
      pm.gender,
      pm.status,
      pm.cost AS kostpris,
      pm.varemodtaget,
      pm.tags,
      GREATEST(COALESCE(pm.price, 0), COALESCE(pm.compare_at_price, 0)) AS vejl_pris,
      pm.product_title,
      pm.variant_title
    FROM product_metadata pm
  ),

  -- 4️⃣ Parse product titles
  title_parsed AS (
    SELECT DISTINCT ON (sku)
      sku,
      split_part(
        CASE WHEN strpos(m.product_title, '|') > 0
             THEN split_part(m.product_title, '|', 1)
             ELSE m.product_title
        END,
        ' - ',
        1
      ) AS produkt,
      CASE
        WHEN strpos(m.product_title, '|') > 0 THEN
          REVERSE(split_part(REVERSE(split_part(m.product_title, '|', 1)), ' - ', 1))
        ELSE
          REVERSE(split_part(REVERSE(m.product_title), ' - ', 1))
      END AS farve,
      m.variant_title AS stoerrelse
    FROM meta m
    WHERE m.product_title IS NOT NULL AND m.product_title != ''
  ),

  -- 5️⃣ Aggregate sales by SKU (including size)
  sales AS (
    SELECT
      sb.created_date_dk AS metric_date,
      sb.sku,
      sb.artikelnummer,
      sb.variant_title AS stoerrelse,
      -- ✅ FIX: solgt = quantity - cancelled_qty (exclude cancelled items)
      SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
      SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
      -- ✅ FIX: revenue_gross excludes cancelled_amount
      SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS revenue_gross,
      SUM(COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS cancelled_amount,
      SUM((sb.discount_per_unit_dkk * sb.quantity))::numeric(14,2) AS order_discounts,
      SUM(sb.sale_discount_total_dkk)::numeric(14,2) AS sale_discounts
    FROM sales_base sb
    GROUP BY sb.created_date_dk, sb.sku, sb.artikelnummer, sb.variant_title
  ),

  -- 6️⃣ Aggregate refunds by SKU
  refunds AS (
    SELECT
      rb.refund_date_dk AS metric_date,
      rb.sku,
      rb.artikelnummer,
      SUM(COALESCE(rb.refunded_qty, 0))::int AS retur,
      SUM(COALESCE(rb.refunded_amount_dkk, 0))::numeric(14,2) AS refunded_amount
    FROM refunds_base rb
    GROUP BY rb.refund_date_dk, rb.sku, rb.artikelnummer
  ),

  -- 7️⃣ Join all data
  joined AS (
    SELECT
      d.metric_date,
      d.sku,
      d.artikelnummer,
      MAX(COALESCE(s.stoerrelse, '')) AS stoerrelse,
      MAX(COALESCE(m.program, '')) AS program,
      MAX(COALESCE(tp.produkt, '')) AS produkt,
      MAX(COALESCE(tp.farve, '')) AS farve,
      MAX(COALESCE(m.season, '')) AS season,
      MAX(COALESCE(m.gender, '')) AS gender,
      SUM(COALESCE(s.solgt, 0)) AS solgt,
      SUM(COALESCE(r.retur, 0)) AS retur,
      SUM(COALESCE(s.cancelled, 0)) AS cancelled,
      -- ✅ omsaetning_net = revenue_gross (already excludes cancelled) - discounts
      SUM(COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0)) AS omsaetning_net,
      SUM(COALESCE(s.cancelled_amount, 0)) AS cancelled_amount,
      SUM(COALESCE(r.refunded_amount, 0)) AS refunded_amount,
      MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
      (MAX(COALESCE(m.kostpris, 0)) * SUM(COALESCE(s.solgt, 0)))::numeric(14,2) AS kostpris,
      MAX(COALESCE(m.status, '')) AS status,
      MAX(COALESCE(m.tags, '')) AS tags,
      MAX(COALESCE(m.vejl_pris, 0))::numeric(14,2) AS vejl_pris
    FROM (
      SELECT metric_date, sku, artikelnummer FROM sales
      UNION
      SELECT metric_date, sku, artikelnummer FROM refunds
    ) d
    LEFT JOIN sales s ON s.metric_date = d.metric_date AND s.sku = d.sku
    LEFT JOIN refunds r ON r.metric_date = d.metric_date AND r.sku = d.sku
    LEFT JOIN meta m ON m.sku = d.sku
    LEFT JOIN title_parsed tp ON tp.sku = d.sku
    GROUP BY d.metric_date, d.sku, d.artikelnummer
  )

  -- 8️⃣ Upsert into daily_sku_metrics
  INSERT INTO daily_sku_metrics (
    metric_date, sku, artikelnummer, stoerrelse, program, produkt, farve, season, gender,
    solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
    varemodtaget, kostpris, status, tags, vejl_pris
  )
  SELECT
    metric_date, sku, artikelnummer, stoerrelse, program, produkt, farve, season, gender,
    solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
    varemodtaget, kostpris, status, tags, vejl_pris
  FROM joined
  ON CONFLICT (metric_date, sku)
  DO UPDATE SET
    artikelnummer = EXCLUDED.artikelnummer,
    stoerrelse = EXCLUDED.stoerrelse,
    program = EXCLUDED.program,
    produkt = EXCLUDED.produkt,
    farve = EXCLUDED.farve,
    season = EXCLUDED.season,
    gender = EXCLUDED.gender,
    solgt = EXCLUDED.solgt,
    retur = EXCLUDED.retur,
    cancelled = EXCLUDED.cancelled,
    omsaetning_net = EXCLUDED.omsaetning_net,
    cancelled_amount = EXCLUDED.cancelled_amount,
    refunded_amount = EXCLUDED.refunded_amount,
    varemodtaget = EXCLUDED.varemodtaget,
    kostpris = EXCLUDED.kostpris,
    status = EXCLUDED.status,
    tags = EXCLUDED.tags,
    vejl_pris = EXCLUDED.vejl_pris;

END;
$$;

COMMENT ON FUNCTION aggregate_color_metrics_for_date(DATE) IS 'FIXED 2025-10-23: solgt excludes cancelled_qty, omsaetning_net excludes cancelled_amount';
COMMENT ON FUNCTION aggregate_sku_metrics_for_date(DATE) IS 'FIXED 2025-10-23: solgt excludes cancelled_qty, omsaetning_net excludes cancelled_amount';
