-- Migration: Backfill sale discount using product_metadata
-- Purpose: Calculate sale_discount from existing product_metadata instead of re-syncing
-- Date: 2025-10-07

-- Step 1: Update original_price_dkk and calculate sale discounts
-- Join with product_metadata to get compare_at_price
UPDATE skus s
SET
  -- Original price = MAX(price from metadata, compare_at_price from metadata)
  original_price_dkk = CASE
    WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
    THEN pm.compare_at_price
    ELSE pm.price
  END,

  -- Sale discount per unit = max(original_price - actual_price, 0)
  sale_discount_per_unit_dkk = GREATEST(
    CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END - s.price_dkk,
    0
  ),

  -- Sale discount total = sale_discount_per_unit * quantity
  sale_discount_total_dkk = GREATEST(
    CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END - s.price_dkk,
    0
  ) * s.quantity
FROM product_metadata pm
WHERE s.sku = pm.sku
  AND (s.original_price_dkk IS NULL OR s.original_price_dkk = 0);

-- Step 2: Update any remaining skus without metadata match (set to 0)
UPDATE skus
SET
  original_price_dkk = price_dkk,
  sale_discount_per_unit_dkk = 0,
  sale_discount_total_dkk = 0
WHERE original_price_dkk IS NULL OR original_price_dkk = 0;

-- Step 3: Aggregate to orders table
SELECT update_order_sale_discount();

-- Verification queries
DO $$
DECLARE
  total_skus_updated INTEGER;
  skus_with_sale_discount INTEGER;
  orders_with_sale_discount INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_skus_updated
  FROM skus
  WHERE original_price_dkk > 0;

  SELECT COUNT(*) INTO skus_with_sale_discount
  FROM skus
  WHERE sale_discount_total_dkk > 0;

  SELECT COUNT(*) INTO orders_with_sale_discount
  FROM orders
  WHERE sale_discount_total > 0;

  RAISE NOTICE '✅ Backfill complete:';
  RAISE NOTICE '   - Total SKUs updated: %', total_skus_updated;
  RAISE NOTICE '   - SKUs with sale discount: %', skus_with_sale_discount;
  RAISE NOTICE '   - Orders with sale discount: %', orders_with_sale_discount;
END $$;
