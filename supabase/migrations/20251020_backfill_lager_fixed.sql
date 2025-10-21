-- Backfill lager data into daily_sku_metrics and daily_color_metrics
-- Uses SPLIT_PART instead of SUBSTRING/POSITION to avoid SQL errors

-- 1️⃣ Backfill lager data into daily_sku_metrics from inventory
UPDATE daily_sku_metrics dsm
SET lager = COALESCE(inv.quantity, 0)
FROM inventory inv
WHERE dsm.sku = inv.sku;

-- 2️⃣ Backfill lager data into daily_color_metrics
-- Sum inventory quantities per artikelnummer using REGEXP_MATCH
-- Extract leading digits before backslash (e.g., "100886\323/One Size" → "100886")
UPDATE daily_color_metrics dcm
SET lager = COALESCE(inv_sum.total_quantity, 0)
FROM (
  SELECT
    (regexp_match(inv.sku, '^(\d+)'))[1] AS artikelnummer,
    SUM(inv.quantity) AS total_quantity
  FROM inventory inv
  WHERE inv.sku ~ '^\d+'  -- Only SKUs starting with digits
  GROUP BY (regexp_match(inv.sku, '^(\d+)'))[1]
) inv_sum
WHERE dcm.artikelnummer = inv_sum.artikelnummer;

-- 3️⃣ Verify results
-- Uncomment below to see sample of updated values
-- SELECT artikelnummer, COUNT(*) as row_count, MAX(lager) as max_lager, SUM(lager) as total_lager
-- FROM daily_color_metrics
-- WHERE lager > 0
-- GROUP BY artikelnummer
-- ORDER BY max_lager DESC
-- LIMIT 10;
