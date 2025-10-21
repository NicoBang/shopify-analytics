-- Add lager column to daily_sku_metrics and daily_color_metrics
-- Lager data comes from inventory table

-- 1️⃣ Add lager column to daily_sku_metrics
ALTER TABLE daily_sku_metrics
ADD COLUMN IF NOT EXISTS lager INTEGER DEFAULT 0;

COMMENT ON COLUMN daily_sku_metrics.lager IS 'Inventory quantity from inventory table (latest snapshot per SKU)';

-- 2️⃣ Add lager column to daily_color_metrics
ALTER TABLE daily_color_metrics
ADD COLUMN IF NOT EXISTS lager INTEGER DEFAULT 0;

COMMENT ON COLUMN daily_color_metrics.lager IS 'Sum of inventory quantities for all SKUs with this artikelnummer';

-- 3️⃣ Create index for faster inventory lookups
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory(sku);

-- 4️⃣ Backfill lager data into daily_sku_metrics from inventory
UPDATE daily_sku_metrics dsm
SET lager = COALESCE(inv.quantity, 0)
FROM inventory inv
WHERE dsm.sku = inv.sku;

-- 5️⃣ Backfill lager data into daily_color_metrics
-- Sum inventory quantities per artikelnummer
UPDATE daily_color_metrics dcm
SET lager = COALESCE(inv_sum.total_quantity, 0)
FROM (
  SELECT
    SUBSTRING(inv.sku FROM 1 FOR POSITION('\\' IN inv.sku) - 1) AS artikelnummer,
    SUM(inv.quantity) AS total_quantity
  FROM inventory inv
  WHERE POSITION('\' IN inv.sku) > 0
  GROUP BY SUBSTRING(inv.sku FROM 1 FOR POSITION('\' IN inv.sku) - 1)
) inv_sum
WHERE dcm.artikelnummer = inv_sum.artikelnummer;
