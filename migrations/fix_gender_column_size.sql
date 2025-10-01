-- Fix gender column size + remove unused produkt/farve columns
-- Gender: VARCHAR(20) → VARCHAR(100) for JSON arrays like ["Girl","Boy","Unisex"]
-- Produkt/Farve: Never have values (parsed from titles in API), remove from DB

-- Step 1: Drop dependent view
DROP VIEW IF EXISTS inventory_with_metadata;

-- Step 2: Alter gender column
ALTER TABLE product_metadata
ALTER COLUMN gender TYPE VARCHAR(100);

-- Step 3: Drop unused columns (produkt and farve are parsed from titles, not stored)
ALTER TABLE product_metadata
DROP COLUMN IF EXISTS produkt,
DROP COLUMN IF EXISTS farve;

-- Step 4: Recreate view without produkt/farve
CREATE OR REPLACE VIEW inventory_with_metadata AS
SELECT
  i.sku,
  i.quantity,
  i.last_updated,
  pm.product_title,
  pm.variant_title,
  pm.status,
  pm.cost,
  pm.program,
  pm.season,
  pm.gender,
  pm.størrelse,
  pm.price,
  pm.compare_at_price,
  pm.tags
FROM inventory i
LEFT JOIN product_metadata pm ON i.sku = pm.sku;

-- Verify the change
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'product_metadata'
AND column_name = 'gender';