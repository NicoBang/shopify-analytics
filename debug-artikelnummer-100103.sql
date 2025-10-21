-- Debug: Why does artikelnummer 100103 create duplicates?

-- Step 1: Check sales_base for 100103 on 2025-09-09
WITH sales_base AS (
  SELECT
    (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
    s.sku,
    s.quantity,
    s.product_title,
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] = '100103'
    AND (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
)
SELECT
  artikelnummer,
  COUNT(*) as antal_rows,
  SUM(quantity) as total_quantity
FROM sales_base
GROUP BY artikelnummer;

-- Step 2: Check if title_parsed creates duplicates
WITH sales_base AS (
  SELECT
    (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date AS created_date_dk,
    s.sku,
    s.quantity,
    s.product_title,
    (regexp_match(s.sku, '^(\d+)'))[1] AS artikelnummer
  FROM skus s
  WHERE (regexp_match(s.sku, '^(\d+)'))[1] = '100103'
    AND (s.created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = '2025-09-09'
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
)
SELECT
  artikelnummer,
  COUNT(*) as antal_rows,
  STRING_AGG(DISTINCT produkt || ' - ' || farve, ', ') as unique_titles
FROM title_parsed
GROUP BY artikelnummer;
