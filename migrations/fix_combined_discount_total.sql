-- Migration: Fix combined_discount_total to use EX TAX values
-- Purpose: combined_discount_total was incorrectly set to INCL TAX in some syncs
-- Date: 2025-10-07

-- PROBLEM: Some orders have combined_discount_total = totalDiscountsInclTax instead of totalDiscountsExTax
-- SOLUTION: Set combined_discount_total = total_discounts_ex_tax + sale_discount_total

-- Step 1: Check current state BEFORE fix
DO $$
DECLARE
  total_orders INTEGER;
  incorrect_orders INTEGER;
  avg_difference NUMERIC;
BEGIN
  SELECT COUNT(*) INTO total_orders FROM orders;

  -- Count orders where combined_discount_total > total_discounts_ex_tax (likely INCL TAX)
  SELECT COUNT(*) INTO incorrect_orders
  FROM orders
  WHERE combined_discount_total > total_discounts_ex_tax * 1.1; -- Allow 10% margin

  -- Calculate average difference
  SELECT AVG(combined_discount_total - total_discounts_ex_tax) INTO avg_difference
  FROM orders
  WHERE combined_discount_total > total_discounts_ex_tax * 1.1;

  RAISE NOTICE '📊 Current state:';
  RAISE NOTICE '   Total orders: %', total_orders;
  RAISE NOTICE '   Orders with likely INCL TAX combined_discount_total: %', incorrect_orders;
  RAISE NOTICE '   Average difference (INCL - EX TAX): % kr', ROUND(avg_difference, 2);
END $$;

-- Step 2: Fix combined_discount_total
-- Set it to total_discounts_ex_tax + sale_discount_total (both EX TAX)
UPDATE orders
SET combined_discount_total = COALESCE(total_discounts_ex_tax, 0) + COALESCE(sale_discount_total, 0);

-- Step 3: Verify results AFTER fix
DO $$
DECLARE
  total_orders INTEGER;
  fixed_orders INTEGER;
  remaining_incorrect INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_orders FROM orders;

  -- Count orders that were just fixed
  SELECT COUNT(*) INTO fixed_orders
  FROM orders
  WHERE combined_discount_total = COALESCE(total_discounts_ex_tax, 0) + COALESCE(sale_discount_total, 0);

  -- Count orders still potentially incorrect
  SELECT COUNT(*) INTO remaining_incorrect
  FROM orders
  WHERE combined_discount_total > total_discounts_ex_tax * 1.1
    AND sale_discount_total = 0;

  RAISE NOTICE '✅ Results after fix:';
  RAISE NOTICE '   Total orders: %', total_orders;
  RAISE NOTICE '   Orders with correct combined_discount_total: %', fixed_orders;
  RAISE NOTICE '   Remaining potentially incorrect: %', remaining_incorrect;
END $$;

-- Add comment to document the fix
COMMENT ON COLUMN orders.combined_discount_total IS 'Total discounts EX TAX = total_discounts_ex_tax + sale_discount_total (both ex moms)';
