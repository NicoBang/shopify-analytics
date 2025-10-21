-- Backfill complete daily metrics (COLOR and SKU level)
-- Based on WORKING migrations from commit c7a008c with solgt fix applied
-- Run this in Supabase SQL Editor

-- ============================================
-- PART 1: daily_color_metrics (COLOR LEVEL)
-- ============================================

-- Clear existing data
TRUNCATE daily_color_metrics;

WITH
-- 1️⃣ Sales data (based on created_at_original with Danish timezone)
sales_base AS (
  SELECT
    s.shop,
    s.order_id,
    s.sku,
    -- Convert UTC timestamp to Danish date (YYYY-MM-DD)
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
    -- Extract artikelnummer (leading numbers before \ or /)
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL  -- Skip invalid SKUs
),

-- 2️⃣ Refund data (based on refund_date with Danish timezone)
refunds_base AS (
  SELECT
    s.shop,
    s.order_id,
    s.sku,
    -- Convert UTC timestamp to Danish date (YYYY-MM-DD)
    (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
    s.refunded_qty,
    s.refunded_amount_dkk,
    -- Extract artikelnummer
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE s.refund_date IS NOT NULL
    AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
),

-- 3️⃣ Get metadata per artikelnummer (FIX: Group ONLY by artikelnummer)
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
  GROUP BY (regexp_match(pm.sku, '^(\d+)'))[1]  -- ✅ FIX: ONLY group by artikelnummer
),

-- 4️⃣ Parse product titles to extract Produkt and Farve
title_parsed AS (
  SELECT DISTINCT
    artikelnummer,
    -- Parse produkt: everything before first ' - '
    split_part(
      CASE WHEN strpos(product_title, '|') > 0
           THEN split_part(product_title, '|', 1)
           ELSE product_title
      END,
      ' - ',
      1
    ) AS produkt,
    -- Parse farve: everything after last ' - ' (before | if exists)
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
    -- ✅ FIX: EXCLUDE cancelled from solgt
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    -- Revenue calculations (INCLUDE cancelled in gross revenue)
    SUM((sb.price_dkk * sb.quantity))::numeric(14,2) AS revenue_gross,
    SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0)))::numeric(14,2) AS cancelled_amount,
    -- Discount calculations (INCLUDE cancelled in discounts)
    SUM((sb.discount_per_unit_dkk * sb.quantity))::numeric(14,2) AS order_discounts,
    SUM(sb.sale_discount_total_dkk)::numeric(14,2) AS sale_discounts
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

-- 7️⃣ Join sales + refunds + metadata (now 1:1 join since meta is unique per artikelnummer)
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
    -- ✅ FIX: Match SKU calculation - subtract cancelled_amount AND refunded_amount
    -- omsaetning_net = revenue_gross - order_discounts - cancelled_amount - refunded_amount
    (COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0) - COALESCE(s.cancelled_amount, 0) - COALESCE(r.refunded_amount, 0))::numeric(10,2) AS omsaetning_net,
    COALESCE(s.cancelled_amount, 0)::numeric(10,2) AS cancelled_amount,  -- Store separately for reference
    COALESCE(r.refunded_amount, 0)::numeric(10,2) AS refunded_amount,    -- Store separately for reference
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


-- ============================================
-- PART 2: daily_sku_metrics (SKU LEVEL)
-- ============================================

-- Clear existing data
TRUNCATE daily_sku_metrics;

WITH
-- 1️⃣ Sales data (based on created_at_original with Danish timezone)
sales_base AS (
  SELECT
    s.shop,
    s.order_id,
    s.sku,
    -- Convert UTC timestamp to Danish date (YYYY-MM-DD)
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
    -- Extract artikelnummer (leading numbers before \ or /)
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL  -- Skip invalid SKUs
),

-- 2️⃣ Refund data (based on refund_date with Danish timezone)
refunds_base AS (
  SELECT
    s.shop,
    s.order_id,
    s.sku,
    -- Convert UTC timestamp to Danish date (YYYY-MM-DD)
    (s.refund_date AT TIME ZONE 'Europe/Copenhagen')::date AS refund_date_dk,
    s.refunded_qty,
    s.refunded_amount_dkk,
    -- Extract artikelnummer
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE s.refund_date IS NOT NULL
    AND (regexp_match(s.sku, '^(\d+)'))[1] IS NOT NULL
),

-- 3️⃣ Get metadata per SKU (including size)
meta AS (
  SELECT
    pm.sku,
    (regexp_match(pm.sku, '^(\d+)'))[1] AS artikelnummer,
    pm.program,
    pm.season,
    pm.gender,
    pm.status,
    pm.cost AS kostpris,
    pm.varemodtaget,
    pm.tags,
    GREATEST(COALESCE(pm.price, 0), COALESCE(pm.compare_at_price, 0)) AS vejl_pris,
    pm.product_title,
    pm.variant_title  -- Size information
  FROM product_metadata pm
  WHERE (regexp_match(pm.sku, '^(\d+)'))[1] IS NOT NULL
),

-- 4️⃣ Parse product titles to extract Produkt and Farve
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

-- 5️⃣ Aggregate sales by SKU (including size)
sales AS (
  SELECT
    sb.created_date_dk AS metric_date,
    sb.sku,
    sb.artikelnummer,
    -- ✅ FIX: EXCLUDE cancelled from solgt
    SUM(sb.quantity - COALESCE(sb.cancelled_qty, 0))::int AS solgt,
    SUM(COALESCE(sb.cancelled_qty, 0))::int AS cancelled,
    -- Revenue calculations (INCLUDE cancelled in gross revenue)
    SUM((sb.price_dkk * sb.quantity))::numeric(14,2) AS revenue_gross,
    SUM((sb.cancelled_amount_dkk * COALESCE(sb.cancelled_qty, 0)))::numeric(14,2) AS cancelled_amount,
    -- Discount calculations (INCLUDE cancelled in discounts)
    SUM((sb.discount_per_unit_dkk * sb.quantity))::numeric(14,2) AS order_discounts,
    SUM(sb.sale_discount_total_dkk)::numeric(14,2) AS sale_discounts
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
    -- ✅ CORRECTED: omsaetning_net = revenue_gross - order_discounts - cancelled_amount - refunded_amount
    SUM(COALESCE(s.revenue_gross, 0) - COALESCE(s.order_discounts, 0) - COALESCE(s.cancelled_amount, 0)) - SUM(COALESCE(r.refunded_amount, 0)) AS omsaetning_net,
    SUM(COALESCE(r.refunded_amount, 0)) AS refunded_amount,
    MAX(COALESCE(m.varemodtaget, 0))::int AS varemodtaget,
    -- ✅ FIXED: kostpris should be TOTAL cost (unit_cost * solgt), not average unit cost
    (AVG(COALESCE(m.kostpris, 0)) * SUM(COALESCE(s.solgt, 0)))::numeric(14,2) AS kostpris,
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

-- 8️⃣ Insert/update daily_sku_metrics
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


-- ============================================
-- VERIFICATION: Check 2025-09-01
-- ============================================

SELECT
  'daily_color_metrics' as table_name,
  metric_date,
  SUM(solgt) as total_solgt,
  SUM(retur) as total_retur,
  SUM(cancelled) as total_cancelled,
  ROUND(SUM(omsaetning_net), 2) as total_omsaetning_net
FROM daily_color_metrics
WHERE metric_date = '2025-09-01'
GROUP BY metric_date;

-- Expected results for 2025-09-01:
-- total_solgt: 78 ✅
-- total_retur: 72 ✅
-- total_cancelled: 1 ✅
-- total_omsaetning_net: 2408.69 ✅
