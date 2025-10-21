-- Delete old incorrect data for 2025-09-09 and rebuild with correct logic
DELETE FROM daily_color_metrics WHERE metric_date = '2025-09-09';

-- Rebuild with CORRECTED meta CTE (group ONLY by artikelnummer)
WITH
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
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
    AND (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
),

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
    AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
    AND (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
),

meta AS (
  SELECT
    (regexp_match(pm.sku, '^(\d+)'))[1] AS artikelnummer,
    MAX(COALESCE(pm.program, '')) AS program,
    MAX(COALESCE(pm.season, '')) AS season,
    MAX(COALESCE(pm.gender, '')) AS gender,
    MAX(COALESCE(pm.status, '')) AS status,
    AVG(COALESCE(pm.cost, 0))::numeric(14,2) AS kostpris,
    MAX(COALESCE(pm.varemodtaget, 0))::int AS varemodtaget,
    MAX(COALESCE(pm.tags, '')) AS tags,
    MAX(GREATEST(COALESCE(pm.price, 0), COALESCE(pm.compare_at_price, 0)))::numeric(14,2) AS vejl_pris
  FROM product_metadata pm
  WHERE (regexp_match(pm.sku, '^(\d+)'))[1] IS NOT NULL
  GROUP BY (regexp_match(pm.sku, '^(\d+)'))[1]  -- ✅ FIX: ONLY artikelnummer!
),

title_parsed AS (
  SELECT DISTINCT
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
),

sales AS (
  SELECT
    sb.created_date_dk AS metric_date,
    sb.artikelnummer,
    SUM(sb.quantity)::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    SUM((sb.price_dkk * sb.quantity))::numeric(14,2) AS revenue_gross,
    SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0)))::numeric(14,2) AS cancelled_amount,
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
),

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
    SUM(COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0)) AS omsaetning_net,
    SUM(COALESCE(r.refunded_amount, 0)) AS refunded_amount,
    MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
    AVG(COALESCE(m.kostpris, 0))::numeric(14,2) AS kostpris,
    MAX(COALESCE(m.status, '')) AS status,
    MAX(COALESCE(m.tags, '')) AS tags,
    MAX(COALESCE(m.vejl_pris, 0))::numeric(14,2) AS vejl_pris
  FROM (
    SELECT metric_date, artikelnummer FROM sales
    UNION
    SELECT metric_date, artikelnummer FROM refunds
  ) d
  LEFT JOIN sales s ON d.metric_date = s.metric_date AND d.artikelnummer = s.artikelnummer
  LEFT JOIN refunds r ON d.metric_date = r.metric_date AND d.artikelnummer = r.artikelnummer
  LEFT JOIN meta m ON d.artikelnummer = m.artikelnummer
  LEFT JOIN title_parsed tp ON d.artikelnummer = tp.artikelnummer
  GROUP BY d.metric_date, d.artikelnummer
)

INSERT INTO daily_color_metrics (
  metric_date, artikelnummer, program, produkt, farve, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris, lager
)
SELECT
  metric_date, artikelnummer, program, produkt, farve, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris,
  0 AS lager
FROM joined;

-- Verify result
SELECT SUM(solgt) AS total_solgt FROM daily_color_metrics WHERE metric_date = '2025-09-09';
