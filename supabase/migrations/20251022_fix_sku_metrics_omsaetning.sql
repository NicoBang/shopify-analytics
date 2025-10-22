-- Fix daily_sku_metrics omsaetning_net calculation
-- Date: 2025-10-22
-- Problem: omsaetning_net was subtracting refunded_amount, but it should NOT
-- Correct: omsaetning_net = (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk
-- refunded_amount is stored separately and subtracted in Google Sheets

-- Drop the old table and recreate with correct calculation
DROP TABLE IF EXISTS daily_sku_metrics CASCADE;

-- Recreate table
CREATE TABLE daily_sku_metrics (
  metric_date DATE NOT NULL,
  sku TEXT NOT NULL,
  artikelnummer TEXT NOT NULL,
  program TEXT,
  produkt TEXT,
  farve TEXT,
  stoerrelse TEXT,
  season TEXT,
  gender TEXT,
  solgt INTEGER DEFAULT 0,
  retur INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  omsaetning_net NUMERIC(10,2) DEFAULT 0,
  refunded_amount NUMERIC(10,2) DEFAULT 0,
  shops TEXT,
  varemodtaget INTEGER DEFAULT 0,
  kostpris NUMERIC(10,2) DEFAULT 0,
  status TEXT,
  tags TEXT,
  vejl_pris NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (metric_date, sku)
);

-- Indexes for performance
CREATE INDEX idx_daily_sku_metrics_date ON daily_sku_metrics(metric_date);
CREATE INDEX idx_daily_sku_metrics_artikelnummer ON daily_sku_metrics(artikelnummer);
CREATE INDEX idx_daily_sku_metrics_sku ON daily_sku_metrics(sku);
CREATE INDEX idx_daily_sku_metrics_season ON daily_sku_metrics(season);

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

-- 3️⃣ Get metadata per SKU
meta AS (
  SELECT
    pm.sku,
    (regexp_match(pm.sku, '^(\d+)'))[1] AS artikelnummer,
    COALESCE(pm.program, '') AS program,
    COALESCE(pm.season, '') AS season,
    COALESCE(pm.gender, '') AS gender,
    COALESCE(pm.status, '') AS status,
    COALESCE(pm.cost, 0)::numeric(14,2) AS kostpris,
    COALESCE(pm.varemodtaget, 0)::int AS varemodtaget,
    COALESCE(pm.tags, '') AS tags,
    GREATEST(COALESCE(pm.price, 0), COALESCE(pm.compare_at_price, 0))::numeric(14,2) AS vejl_pris
  FROM product_metadata pm
  WHERE (regexp_match(pm.sku, '^(\d+)'))[1] IS NOT NULL
),

-- 4️⃣ Parse product titles and extract size
title_parsed AS (
  SELECT DISTINCT
    sku,
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
    END AS farve,
    COALESCE(variant_title, '') AS stoerrelse
  FROM sales_base
  WHERE product_title IS NOT NULL AND product_title != ''
),

-- 5️⃣ Aggregate sales by SKU (including size)
sales AS (
  SELECT
    sb.created_date_dk AS metric_date,
    sb.sku,
    sb.artikelnummer,
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    -- ✅ CORRECT: (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk
    SUM((sb.price_dkk * sb.quantity) - COALESCE(sb.total_discount_dkk, 0) - COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS revenue_net,
    SUM(COALESCE(sb.cancelled_amount_dkk, 0))::numeric(14,2) AS cancelled_amount
  FROM sales_base sb
  GROUP BY sb.created_date_dk, sb.sku, sb.artikelnummer
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

-- 7️⃣ Join sales + refunds + metadata
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
    -- ✅ CORRECT: omsaetning_net does NOT subtract refunded_amount
    SUM(COALESCE(s.revenue_net, 0))::numeric(10,2) AS omsaetning_net,
    SUM(COALESCE(r.refunded_amount, 0))::numeric(10,2) AS refunded_amount,
    MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
    (AVG(COALESCE(m.kostpris, 0)) * SUM(COALESCE(s.solgt, 0)))::numeric(14,2) AS kostpris,
    MAX(COALESCE(m.status, '')) AS status,
    MAX(COALESCE(m.tags, '')) AS tags,
    MAX(COALESCE(m.vejl_pris, 0))::numeric(14,2) AS vejl_pris
  FROM (
    SELECT metric_date, sku, artikelnummer FROM sales
    UNION
    SELECT metric_date, sku, artikelnummer FROM refunds
  ) d
  LEFT JOIN sales s ON s.metric_date = d.metric_date AND s.sku = d.sku AND s.artikelnummer = d.artikelnummer
  LEFT JOIN refunds r ON r.metric_date = d.metric_date AND r.sku = d.sku AND r.artikelnummer = d.artikelnummer
  LEFT JOIN meta m ON m.sku = d.sku
  LEFT JOIN (
    SELECT DISTINCT ON (sku) sku, artikelnummer, produkt, farve, stoerrelse
    FROM title_parsed
  ) tp ON tp.sku = d.sku
  GROUP BY d.metric_date, d.sku, d.artikelnummer
)

-- 8️⃣ Insert into daily_sku_metrics
INSERT INTO daily_sku_metrics (
  metric_date, sku, artikelnummer, program, produkt, farve, stoerrelse, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
)
SELECT
  metric_date, sku, artikelnummer, program, produkt, farve, stoerrelse, season, gender,
  solgt, retur, cancelled, omsaetning_net, refunded_amount,
  varemodtaget, kostpris, status, tags, vejl_pris
FROM joined;
