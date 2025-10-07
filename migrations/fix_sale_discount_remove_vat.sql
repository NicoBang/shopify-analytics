-- Migration: Fix sale discount to use EX TAX prices
-- Purpose: product_metadata has INCL TAX prices, but we need EX TAX for calculations
-- Date: 2025-10-07

-- IMPORTANT: This fixes the previous backfill which incorrectly used INCL TAX prices

-- Step 1: Recalculate using EX TAX prices (divide by 1.25 to remove 25% VAT)
UPDATE skus s
SET
  -- Original price EX TAX = MAX(price, compare_at_price) / 1.25
  original_price_dkk = (CASE
    WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
    THEN pm.compare_at_price
    ELSE pm.price
  END) / 1.25,

  -- Sale discount per unit EX TAX = max(original_price_ex_tax - actual_price_ex_tax, 0)
  sale_discount_per_unit_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END) / 1.25 - s.price_dkk,
    0
  ),

  -- Sale discount total = sale_discount_per_unit * quantity
  sale_discount_total_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END) / 1.25 - s.price_dkk,
    0
  ) * s.quantity
FROM product_metadata pm
WHERE s.sku = pm.sku;

-- Step 2: Re-aggregate to orders table
SELECT update_order_sale_discount();

-- Verification queries
DO $$
DECLARE
  total_skus_updated INTEGER;
  skus_with_sale_discount INTEGER;
  orders_with_sale_discount INTEGER;
  total_sale_discount NUMERIC;
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

  SELECT ROUND(SUM(sale_discount_total)::numeric, 2) INTO total_sale_discount
  FROM orders;

  RAISE NOTICE '✅ Fix complete (EX TAX):';
  RAISE NOTICE '   - Total SKUs updated: %', total_skus_updated;
  RAISE NOTICE '   - SKUs with sale discount: %', skus_with_sale_discount;
  RAISE NOTICE '   - Orders with sale discount: %', orders_with_sale_discount;
  RAISE NOTICE '   - Total sale discount (should be ~20%% less than before): % DKK', total_sale_discount;
END $$;
