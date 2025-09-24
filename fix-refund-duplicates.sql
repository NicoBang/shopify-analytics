-- fix-refund-duplicates.sql
-- Håndterer refund-opdateringer korrekt ved at beholde den NYESTE record (med refund info)

-- Step 1: Se problemet - find records der har både version med og uden refund
SELECT
  shop,
  order_id,
  sku,
  COUNT(*) as versions,
  MAX(refund_date) as latest_refund_date,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded
FROM skus
WHERE created_at >= '2025-01-01'
GROUP BY shop, order_id, sku
HAVING COUNT(*) > 1
LIMIT 20;

-- Step 2: Vis et konkret eksempel
SELECT
  id,
  shop,
  order_id,
  sku,
  created_at,
  quantity,
  refunded_qty,
  refund_date
FROM skus
WHERE (shop, order_id, sku) IN (
  SELECT shop, order_id, sku
  FROM skus
  GROUP BY shop, order_id, sku
  HAVING COUNT(*) > 1
)
ORDER BY shop, order_id, sku, created_at
LIMIT 10;

-- Step 3: VIGTIGT - Fjern de GAMLE records (behold den NYESTE med refund info)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY shop, order_id, sku
      -- VIGTIGT: Order by created_at DESC for at beholde den NYESTE
      -- Eller endnu bedre: prioriter records MED refund_date
      ORDER BY
        CASE WHEN refund_date IS NOT NULL THEN 1 ELSE 2 END,  -- Prioriter records med refund
        created_at DESC,  -- Dernæst tag den nyeste
        id DESC
    ) as rn
  FROM skus
)
DELETE FROM skus
WHERE id IN (
  SELECT id
  FROM duplicates
  WHERE rn > 1  -- Slet alt undtagen den første (som nu er den med refund eller den nyeste)
);

-- Step 4: Verificer at det virkede
SELECT
  COUNT(*) as total_records,
  COUNT(DISTINCT (shop, order_id, sku)) as unique_combinations,
  SUM(quantity) as total_quantity,
  SUM(refunded_qty) as total_refunded
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17';

-- Step 5: Tjek artikelnummer 20204 specifikt
SELECT
  shop,
  sku,
  quantity,
  refunded_qty,
  refund_date
FROM skus
WHERE created_at >= '2025-01-16'
  AND created_at < '2025-01-17'
  AND sku LIKE '20204%';

-- Step 6: Tilføj unique constraint for fremtiden
ALTER TABLE skus
DROP CONSTRAINT IF EXISTS skus_unique_shop_order_sku;

ALTER TABLE skus
ADD CONSTRAINT skus_unique_shop_order_sku
UNIQUE (shop, order_id, sku);