-- fix-duplicates-improved.sql
-- FORBEDRET VERSION: Håndterer alle typer duplikater korrekt

-- ============================================
-- TRIN 1: UNDERSØG PROBLEMET
-- ============================================

-- 1a. Se hvor mange duplikater vi har (baseret på shop, order_id, sku)
SELECT
  COUNT(*) as total_records,
  COUNT(DISTINCT concat(shop, '-', order_id, '-', sku)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT concat(shop, '-', order_id, '-', sku)) as duplicate_records
FROM skus;

-- 1b. Find eksempler på duplikater
SELECT
  shop,
  order_id,
  sku,
  COUNT(*) as duplicate_count,
  MAX(refund_date) as has_refund,
  MIN(created_at) as first_created,
  MAX(created_at) as last_created
FROM skus
GROUP BY shop, order_id, sku
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- 1c. Vis konkrete eksempler med alle felter
SELECT
  id,
  shop,
  order_id,
  sku,
  created_at,
  quantity,
  refunded_qty,
  refund_date,
  price_dkk
FROM skus
WHERE (shop, order_id, sku) IN (
  SELECT shop, order_id, sku
  FROM skus
  GROUP BY shop, order_id, sku
  HAVING COUNT(*) > 1
)
ORDER BY shop, order_id, sku, created_at DESC
LIMIT 30;

-- ============================================
-- TRIN 2: BACKUP (VALGFRIT MEN ANBEFALET)
-- ============================================

-- Opret backup tabel før vi sletter noget
CREATE TABLE IF NOT EXISTS skus_backup_before_dedup AS
SELECT * FROM skus;

-- ============================================
-- TRIN 3: FJERN DUPLIKATER - BEHOLD DEN BEDSTE VERSION
-- ============================================

-- VIGTIGT: Vi beholder den record der har:
-- 1. Refund information (hvis tilgængelig)
-- 2. Den nyeste created_at (hvis ingen har refund)
-- 3. Den højeste id (som tiebreaker)

WITH ranked_records AS (
  SELECT
    id,
    shop,
    order_id,
    sku,
    created_at,
    refund_date,
    refunded_qty,
    ROW_NUMBER() OVER (
      PARTITION BY shop, order_id, sku
      ORDER BY
        -- Prioriter records med refund_date
        CASE WHEN refund_date IS NOT NULL THEN 0 ELSE 1 END,
        -- Prioriter records med refunded_qty > 0
        CASE WHEN refunded_qty > 0 THEN 0 ELSE 1 END,
        -- Tag den nyeste created_at
        created_at DESC,
        -- Brug id som tiebreaker
        id DESC
    ) as rank_num
  FROM skus
)
DELETE FROM skus
WHERE id IN (
  SELECT id
  FROM ranked_records
  WHERE rank_num > 1
);

-- ============================================
-- TRIN 4: VERIFICER RESULTATET
-- ============================================

-- 4a. Tjek at duplikater er væk
SELECT
  COUNT(*) as total_records_after,
  COUNT(DISTINCT concat(shop, '-', order_id, '-', sku)) as unique_combinations_after,
  COUNT(*) - COUNT(DISTINCT concat(shop, '-', order_id, '-', sku)) as remaining_duplicates
FROM skus;

-- 4b. Tjek specific date (16. januar 2025)
SELECT
  'After cleanup' as status,
  COUNT(*) as total_records,
  COUNT(DISTINCT sku) as unique_skus,
  SUM(quantity) as total_quantity_sold,
  SUM(refunded_qty) as total_refunded
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17';

-- 4c. Tjek artikelnummer 20204 specifikt
SELECT
  sku,
  COUNT(*) as order_count,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17'
  AND sku LIKE '20204%'
GROUP BY sku;

-- ============================================
-- TRIN 5: TILFØJ UNIQUE CONSTRAINT
-- ============================================

-- Først drop eksisterende constraint hvis den findes
ALTER TABLE skus
DROP CONSTRAINT IF EXISTS skus_unique_shop_order_sku;

-- Tilføj ny constraint for at forhindre fremtidige duplikater
ALTER TABLE skus
ADD CONSTRAINT skus_unique_shop_order_sku
UNIQUE (shop, order_id, sku);

-- ============================================
-- TRIN 6: OPRYDNING (VALGFRIT)
-- ============================================

-- Hvis alt ser godt ud, kan du droppe backup tabellen
-- DROP TABLE IF EXISTS skus_backup_before_dedup;

-- ============================================
-- NOTES:
-- ============================================
-- Kør hver sektion separat og tjek resultaterne
-- Især vigtigt at tjekke TRIN 1 før du kører TRIN 3
-- Backup tabellen kan slettes når du er sikker på resultaterne