-- Migration: Update sale discount using EUR and CHF price tables
-- Purpose: Use correct currency prices based on shop
-- Date: 2025-10-07

-- IMPORTANT: Run this AFTER populating product_prices_eur and product_prices_chf

-- Step 1: Update DKK shop SKUs (keep existing logic)
UPDATE skus s
SET
  original_price_dkk = (CASE
    WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
    THEN pm.compare_at_price
    ELSE pm.price
  END) / 1.25,

  sale_discount_per_unit_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END) / 1.25 - s.price_dkk,
    0
  ),

  sale_discount_total_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pm.compare_at_price, 0) > COALESCE(pm.price, 0)
      THEN pm.compare_at_price
      ELSE pm.price
    END) / 1.25 - s.price_dkk,
    0
  ) * s.quantity
FROM product_metadata pm
WHERE s.sku = pm.sku
  AND s.shop = 'pompdelux-da.myshopify.com';

-- Step 2: Update EUR shops (DE, INT, NL)
-- EUR has 19% VAT for most items, but we'll use 1.19 as standard
UPDATE skus s
SET
  original_price_dkk = (CASE
    WHEN COALESCE(pe.compare_at_price, 0) > COALESCE(pe.price, 0)
    THEN pe.compare_at_price
    ELSE pe.price
  END) / 1.19 * 7.45, -- Remove 19% VAT, convert EUR to DKK (rate ~7.45)

  sale_discount_per_unit_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pe.compare_at_price, 0) > COALESCE(pe.price, 0)
      THEN pe.compare_at_price
      ELSE pe.price
    END) / 1.19 * 7.45 - s.price_dkk,
    0
  ),

  sale_discount_total_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pe.compare_at_price, 0) > COALESCE(pe.price, 0)
      THEN pe.compare_at_price
      ELSE pe.price
    END) / 1.19 * 7.45 - s.price_dkk,
    0
  ) * s.quantity
FROM product_prices_eur pe
WHERE s.sku = pe.sku
  AND s.shop IN ('pompdelux-de.myshopify.com', 'pompdelux-int.myshopify.com', 'pompdelux-nl.myshopify.com');

-- Step 3: Update CHF shop
-- CHF has 7.7% VAT standard, use 1.077
UPDATE skus s
SET
  original_price_dkk = (CASE
    WHEN COALESCE(pc.compare_at_price, 0) > COALESCE(pc.price, 0)
    THEN pc.compare_at_price
    ELSE pc.price
  END) / 1.077 * 6.92, -- Remove 7.7% VAT, convert CHF to DKK (rate ~6.92)

  sale_discount_per_unit_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pc.compare_at_price, 0) > COALESCE(pc.price, 0)
      THEN pc.compare_at_price
      ELSE pc.price
    END) / 1.077 * 6.92 - s.price_dkk,
    0
  ),

  sale_discount_total_dkk = GREATEST(
    (CASE
      WHEN COALESCE(pc.compare_at_price, 0) > COALESCE(pc.price, 0)
      THEN pc.compare_at_price
      ELSE pc.price
    END) / 1.077 * 6.92 - s.price_dkk,
    0
  ) * s.quantity
FROM product_prices_chf pc
WHERE s.sku = pc.sku
  AND s.shop = 'pompdelux-chf.myshopify.com';

-- Step 4: Re-aggregate to orders table
SELECT update_order_sale_discount();

-- Verification queries
DO $$
DECLARE
  skus_dk INTEGER;
  skus_eur INTEGER;
  skus_chf INTEGER;
  total_sale_discount NUMERIC;
BEGIN
  SELECT COUNT(*) INTO skus_dk
  FROM skus
  WHERE shop = 'pompdelux-da.myshopify.com' AND sale_discount_total_dkk > 0;

  SELECT COUNT(*) INTO skus_eur
  FROM skus
  WHERE shop IN ('pompdelux-de.myshopify.com', 'pompdelux-int.myshopify.com', 'pompdelux-nl.myshopify.com')
    AND sale_discount_total_dkk > 0;

  SELECT COUNT(*) INTO skus_chf
  FROM skus
  WHERE shop = 'pompdelux-chf.myshopify.com' AND sale_discount_total_dkk > 0;

  SELECT ROUND(SUM(sale_discount_total)::numeric, 2) INTO total_sale_discount
  FROM orders;

  RAISE NOTICE '✅ Multi-currency sale discount update complete:';
  RAISE NOTICE '   - DK shop SKUs with sale discount: %', skus_dk;
  RAISE NOTICE '   - EUR shops SKUs with sale discount: %', skus_eur;
  RAISE NOTICE '   - CHF shop SKUs with sale discount: %', skus_chf;
  RAISE NOTICE '   - Total sale discount across all shops: % DKK', total_sale_discount;
END $$;
