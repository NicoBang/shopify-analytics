-- Fix daily_color_metrics omsaetning_net calculation
-- Date: 2025-10-22
-- Problem: omsaetning_net was subtracting refunded_amount, but it should NOT
-- Correct: omsaetning_net = (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk
-- refunded_amount is stored separately and subtracted in Google Sheets

-- Drop the old migration logic and replace with correct calculation
DROP TABLE IF EXISTS daily_color_metrics CASCADE;

-- Recreate table
CREATE TABLE daily_color_metrics (
  metric_date DATE NOT NULL,
  artikelnummer TEXT NOT NULL,
  program TEXT,
  produkt TEXT,
  farve TEXT,
  season TEXT,
  gender TEXT,
  solgt INTEGER DEFAULT 0,
  retur INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  omsaetning_net NUMERIC(10,2) DEFAULT 0,
  cancelled_amount NUMERIC(10,2) DEFAULT 0,
  refunded_amount NUMERIC(10,2) DEFAULT 0,
  varemodtaget INTEGER DEFAULT 0,
  kostpris NUMERIC(10,2) DEFAULT 0,
  status TEXT,
  tags TEXT,
  vejl_pris NUMERIC(10,2) DEFAULT 0,
  lager INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (metric_date, artikelnummer)
);

-- Indexes for performance
CREATE INDEX idx_daily_color_metrics_date ON daily_color_metrics(metric_date);
CREATE INDEX idx_daily_color_metrics_artikelnummer ON daily_color_metrics(artikelnummer);
CREATE INDEX idx_daily_color_metrics_season ON daily_color_metrics(season);

-- Populate with CORRECT calculation
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
    s.total_discount_dkk,
    s.product_title,
    s.variant_title,
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
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
    AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
),

-- 3️⃣ Get metadata per artikelnummer
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
  GROUP BY (regexp_match(pm.sku, '^(\d+)'))[1]
),

-- 4️⃣ Parse product titles to extract Produkt and Farve
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

-- 5️⃣ Aggregate sales by artikelnummer (color level)
sales AS (
  SELECT
    sb.created_date_dk AS metric_date,
    sb.artikelnummer,
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    -- ✅ CORRECT: (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk
    SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.total_discount_dkk, 0) - COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS revenue_net,
    SUM(COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS cancelled_amount
  FROM sales_base sb
  GROUP BY sb.created_date_dk, sb.artikelnummer
),

-- 6️⃣ Aggregate refunds by artikelnummer (color level)
refunds AS (
  SELECT
    rb.refund_date_dk AS metric_date,
    rb.artikelnummer,
    SUM(COALESCE(rb.refunded_qty, 0))::int AS retur,
    SUM(COALESCE(rb.refunded_amount_dkk, 0))::numeric(14,2) AS refunded_amount
  FROM refunds_base rb
  GROUP BY rb.refund_date_dk, rb.artikelnummer
),

-- 7️⃣ Join sales + refunds + metadata
joined AS (
  SELECT
    d.metric_date,
    d.artikelnummer,
    COALESCE(m.program, '') AS program,
    COALESCE(tp.produkt, '') AS produkt,
    COALESCE(tp.farve, '') AS farve,
    COALESCE(m.season, '') AS season,
    COALESCE(m.gender, '') AS gender,
    COALESCE(s.solgt, 0) AS solgt,
    COALESCE(r.retur, 0) AS retur,
    COALESCE(s.cancelled, 0) AS cancelled,
    -- ✅ CORRECT: omsaetning_net does NOT subtract refunded_amount
    COALESCE(s.revenue_net, 0)::numeric(10,2) AS omsaetning_net,
    COALESCE(s.cancelled_amount, 0)::numeric(10,2) AS cancelled_amount,
    COALESCE(r.refunded_amount, 0)::numeric(10,2) AS refunded_amount,
    COALESCE(m.varemodtaget, 0)::int AS varemodtaget,
    COALESCE(m.kostpris, 0)::numeric(14,2) AS kostpris,
    COALESCE(m.status, '') AS status,
    COALESCE(m.tags, '') AS tags,
    COALESCE(m.vejl_pris, 0)::numeric(14,2) AS vejl_pris
  FROM (
    SELECT metric_date, artikelnummer FROM sales
    UNION
    SELECT metric_date, artikelnummer FROM refunds
  ) d
  LEFT JOIN sales s ON s.metric_date = d.metric_date AND s.artikelnummer = d.artikelnummer
  LEFT JOIN refunds r ON r.metric_date = d.metric_date AND r.artikelnummer = d.artikelnummer
  LEFT JOIN meta m ON m.artikelnummer = d.artikelnummer
  LEFT JOIN (
    SELECT DISTINCT ON (artikelnummer) artikelnummer, produkt, farve
    FROM title_parsed
  ) tp ON tp.artikelnummer = d.artikelnummer
)

-- 8️⃣ Insert into daily_color_metrics
INSERT INTO daily_color_metrics (
  metric_date, artikelnummer, program, produkt, farve, season, gender,
  solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
)
SELECT
  metric_date, artikelnummer, program, produkt, farve, season, gender,
  solgt, retur, cancelled, omsaetning_net, cancelled_amount, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
FROM joined;
