-- Fix daily_color_metrics for 2025-09-09 - FINAL VERSION with no duplicates
DELETE FROM daily_color_metrics WHERE metric_date = '2025-09-09';

WITH
sales_base AS (
  SELECT
    (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
    s.quantity,
    s.cancelled_qty,
    s.price_dkk,
    s.cancelled_amount_dkk,
    s.discount_per_unit_dkk,
    s.sale_discount_total_dkk,
    s.product_title,
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
    AND (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
),

refunds_base AS (
  SELECT
    (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
    s.refunded_qty,
    s.refunded_amount_dkk,
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE s.refund_date IS NOT NULL
    AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
    AND (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
),

-- Get one metadata row per artikelnummer using DISTINCT ON
artikelnummer_meta AS (
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

-- Get one title row per artikelnummer using DISTINCT ON (not DISTINCT!)
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

sales AS (
  SELECT
    sb.created_date_dk AS metric_date,
    sb.artikelnummer,
    SUM(sb.quantity)::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    SUM((sb.price_dkk * sb.quantity))::numeric(14,2) AS revenue_gross,
    SUM((sb.discount_per_unit_dkk * sb.quantity))::numeric(14,2) AS order_discounts,
    SUM(sb.sale_discount_total_dkk)::numeric(14,2) AS sale_discounts
  FROM sales_base sb
  GROUP BY sb.created_date_dk, sb.artikelnummer
),

refunds AS (
  SELECT
    rb.refund_date_dk AS metric_date,
    rb.artikelnummer,
    SUM(COALESCE(rb.refunded_qty, 0))::int AS retur,
    SUM(COALESCE(rb.refunded_amount_dkk, 0))::numeric(14,2) AS refunded_amount
  FROM refunds_base rb
  GROUP BY rb.refund_date_dk, rb.artikelnummer
)

INSERT INTO daily_color_metrics (
  metric_date, artikelnummer, program, produkt, farve, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris, lager
)
SELECT
  COALESCE(s.metric_date, r.metric_date) AS metric_date,
  COALESCE(s.artikelnummer, r.artikelnummer) AS artikelnummer,
  COALESCE(m.program, '') AS program,
  COALESCE(tp.produkt, '') AS produkt,
  COALESCE(tp.farve, '') AS farve,
  COALESCE(m.season, '') AS season,
  COALESCE(m.gender, '') AS gender,
  COALESCE(s.solgt, 0) AS solgt,
  COALESCE(r.retur, 0) AS retur,
  COALESCE(s.cancelled, 0) AS cancelled,
  COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0) AS omsaetning_net,
  COALESCE(r.refunded_amount, 0) AS refunded_amount,
  COALESCE(m.varemodtaget, 0) AS varemodtaget,
  COALESCE(m.kostpris, 0) AS kostpris,
  COALESCE(m.status, '') AS status,
  COALESCE(m.tags, '') AS tags,
  COALESCE(m.vejl_pris, 0) AS vejl_pris,
  0 AS lager
FROM sales s
FULL OUTER JOIN refunds r ON s.metric_date = r.metric_date AND s.artikelnummer = r.artikelnummer
LEFT JOIN artikelnummer_meta m ON COALESCE(s.artikelnummer, r.artikelnummer) = m.artikelnummer
LEFT JOIN title_parsed tp ON COALESCE(s.artikelnummer, r.artikelnummer) = tp.artikelnummer;

-- Verify
SELECT SUM(solgt) AS total_solgt FROM daily_color_metrics WHERE metric_date = '2025-09-09';
