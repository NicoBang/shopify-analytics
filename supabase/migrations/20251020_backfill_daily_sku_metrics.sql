-- Backfill daily_sku_metrics from raw skus + product_metadata
-- Similar to daily_color_metrics but aggregates per SKU (including size)
-- Assumes skus.created_at_original and skus.refund_date are TIMESTAMPTZ in UTC

WITH sku_base AS (
  SELECT
    s.shop,
    s.order_id,
    s.sku,
    (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
    CASE WHEN s.refund_date IS NOT NULL
         THEN (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date
         ELSE NULL END AS refund_date_dk,
    s.quantity,
    s.cancelled_qty,
    s.refunded_qty,
    s.price_dkk,
    s.refunded_amount_dkk,
    s.product_title,
    s.variant_title,
    -- Extract artikelnummer (leading numbers before \ or /)
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL  -- Skip invalid SKUs
),
-- Get metadata per SKU (not aggregated by artikelnummer - we need size-specific data)
meta AS (
  SELECT
    pm.sku,
    (regexp_match(pm.sku, '^(\d+)'))[1] AS artikelnummer,
    pm.program,
    pm.season,
    pm.gender,
    pm.status,
    pm.cost,
    pm.varemodtaget,
    pm.tags,
    pm.price,
    pm.compare_at_price,
    pm.product_title,
    pm.variant_title  -- Size information
  FROM product_metadata pm
  WHERE (regexp_match(pm.sku, '^(\d+)'))[1] IS NOT NULL
),
-- Title parsing from product_metadata (Danish titles only)
-- Produkt: Everything before first ' - '
-- Farve: Everything after last ' - ' (before | if exists)
title_parsed AS (
  SELECT
    m.sku,
    m.artikelnummer,
    -- Parse produkt: everything before first ' - '
    split_part(
      CASE WHEN strpos(m.product_title, '|') > 0
           THEN split_part(m.product_title, '|', 1)
           ELSE m.product_title
      END,
      ' - ',
      1
    ) AS produkt,
    -- Parse farve: everything after last ' - ' (before | if exists)
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
sales AS (
  -- Aggregate sales on created_date_dk per SKU (including size)
  SELECT
    b.created_date_dk AS metric_date,
    b.sku,
    b.artikelnummer,
    SUM(GREATEST((b.quantity - COALESCE(b.cancelled_qty, 0)), 0))::int AS solgt,
    SUM(COALESCE(b.cancelled_qty, 0))::int AS cancelled,
    SUM((COALESCE(b.price_dkk, 0) * GREATEST((b.quantity - COALESCE(b.cancelled_qty, 0)), 0)))::numeric(14,2) AS revenue_gross
  FROM sku_base b
  GROUP BY 1,2,3
),
refunds AS (
  -- Aggregate refunds on refund_date_dk per SKU
  SELECT
    b.refund_date_dk AS metric_date,
    b.sku,
    b.artikelnummer,
    SUM(COALESCE(b.refunded_qty, 0))::int AS retur,
    SUM(COALESCE(b.refunded_amount_dkk, 0))::numeric(14,2) AS refunded_amount
  FROM sku_base b
  WHERE b.refund_date_dk IS NOT NULL
  GROUP BY 1,2,3
),
joined AS (
  SELECT
    d.metric_date,
    d.sku,
    d.artikelnummer,
    MAX(COALESCE(m.program, '')) AS program,
    MAX(COALESCE(tp.produkt, '')) AS produkt,
    MAX(COALESCE(tp.farve, '')) AS farve,
    MAX(COALESCE(tp.stoerrelse, '')) AS stoerrelse,
    MAX(COALESCE(m.season, '')) AS season,
    MAX(COALESCE(m.gender, '')) AS gender,
    SUM(COALESCE(s.solgt, 0)) AS solgt,
    SUM(COALESCE(r.retur, 0)) AS retur,
    SUM(COALESCE(s.cancelled, 0)) AS cancelled,
    SUM(COALESCE(s.revenue_gross, 0) - COALESCE(r.refunded_amount, 0)) AS omsaetning_net,
    SUM(COALESCE(r.refunded_amount, 0)) AS refunded_amount,
    MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
    AVG(COALESCE(m.cost, 0))::numeric(14,2) AS kostpris,
    MAX(COALESCE(m.status, '')) AS status,
    MAX(COALESCE(m.tags, '')) AS tags,
    MAX(GREATEST(COALESCE(m.price, 0), COALESCE(m.compare_at_price, 0)))::numeric(14,2) AS vejl_pris
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
INSERT INTO daily_sku_metrics (
  metric_date, sku, artikelnummer, program, produkt, farve, stoerrelse, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
)
SELECT
  metric_date, sku, artikelnummer, program, produkt, farve, stoerrelse, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
FROM joined
ON CONFLICT (metric_date, sku)
DO UPDATE SET
  program = EXCLUDED.program,
  produkt = EXCLUDED.produkt,
  farve = EXCLUDED.farve,
  stoerrelse = EXCLUDED.stoerrelse,
  season = EXCLUDED.season,
  gender = EXCLUDED.gender,
  solgt = EXCLUDED.solgt,
  retur = EXCLUDED.retur,
  cancelled = EXCLUDED.cancelled,
  omsaetning_net = EXCLUDED.omsaetning_net,
  refunded_amount = EXCLUDED.refunded_amount,
  varemodtaget = EXCLUDED.varemodtaget,
  kostpris = EXCLUDED.kostpris,
  status = EXCLUDED.status,
  tags = EXCLUDED.tags,
  vejl_pris = EXCLUDED.vejl_pris,
  updated_at = NOW();
