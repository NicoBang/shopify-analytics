-- Fix historical discount data in skus table
-- This script corrects discount_per_unit_dkk and original_price_dkk for all SKUs

-- STEP 0: Update SKUs WITHOUT metadata (discontinued products)
-- For these, we assume no sale discount (original_price = current_price)
-- CRITICAL: Handle SKU name mismatch (order SKUs use "/" but product SKUs use "\")
UPDATE skus s
SET
  original_price_dkk = s.price_dkk,
  sale_discount_per_unit_dkk = 0,
  sale_discount_total_dkk = 0,
  discount_per_unit_dkk = s.total_discount_dkk / s.quantity
WHERE s.shop = 'pompdelux-da.myshopify.com'
  AND NOT EXISTS (
    SELECT 1 FROM product_metadata pm WHERE pm.sku = s.sku OR pm.sku = REPLACE(s.sku, '/', '\')
  );

-- Step 1: Update original_price_dkk and sale discounts from product_metadata (DKK shop)
-- CRITICAL: Handle SKU name mismatch (order SKUs use "/" but product SKUs use "\")
UPDATE skus s
SET
  original_price_dkk = GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25)),
  sale_discount_per_unit_dkk = GREATEST(
    (GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk,
    0
  ),
  sale_discount_total_dkk = GREATEST(
    ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk) * s.quantity,
    0
  ),
  discount_per_unit_dkk = GREATEST(
    (s.total_discount_dkk -
      GREATEST(
        ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk) * s.quantity,
        0
      )
    ) / s.quantity,
    0
  )
FROM product_metadata pm
WHERE s.shop = 'pompdelux-da.myshopify.com'
  AND (s.sku = pm.sku OR REPLACE(s.sku, '/', '\') = pm.sku)
  AND pm.compare_at_price IS NOT NULL;

-- STEP 0b: Update EUR SKUs WITHOUT metadata
UPDATE skus s
SET
  original_price_dkk = s.price_dkk,
  sale_discount_per_unit_dkk = 0,
  sale_discount_total_dkk = 0,
  discount_per_unit_dkk = s.total_discount_dkk / s.quantity
WHERE s.shop IN ('pompdelux-de.myshopify.com', 'pompdelux-nl.myshopify.com', 'pompdelux-int.myshopify.com')
  AND NOT EXISTS (
    SELECT 1 FROM product_metadata_eur pm WHERE pm.sku = s.sku OR pm.sku = REPLACE(s.sku, '/', '\')
  );

-- STEP 0c: Update CHF SKUs WITHOUT metadata
UPDATE skus s
SET
  original_price_dkk = s.price_dkk,
  sale_discount_per_unit_dkk = 0,
  sale_discount_total_dkk = 0,
  discount_per_unit_dkk = s.total_discount_dkk / s.quantity
WHERE s.shop = 'pompdelux-chf.myshopify.com'
  AND NOT EXISTS (
    SELECT 1 FROM product_metadata_chf pm WHERE pm.sku = s.sku OR pm.sku = REPLACE(s.sku, '/', '\')
  );

-- Step 2: Update from product_metadata_eur (EUR shops)
UPDATE skus s
SET
  original_price_dkk = GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25)),
  sale_discount_per_unit_dkk = GREATEST(
    (GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk,
    0
  ),
  sale_discount_total_dkk = GREATEST(
    ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk) * s.quantity,
    0
  ),
  discount_per_unit_dkk = GREATEST(
    (s.total_discount_dkk -
      GREATEST(
        ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.25))) - s.price_dkk) * s.quantity,
        0
      )
    ) / s.quantity,
    0
  )
FROM product_metadata_eur pm
WHERE s.shop IN ('pompdelux-de.myshopify.com', 'pompdelux-nl.myshopify.com', 'pompdelux-int.myshopify.com')
  AND (s.sku = pm.sku OR REPLACE(s.sku, '/', '\') = pm.sku)
  AND pm.compare_at_price IS NOT NULL;

-- Step 3: Update from product_metadata_chf (CHF shop)
UPDATE skus s
SET
  original_price_dkk = GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.077)),
  sale_discount_per_unit_dkk = GREATEST(
    (GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.077))) - s.price_dkk,
    0
  ),
  sale_discount_total_dkk = GREATEST(
    ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.077))) - s.price_dkk) * s.quantity,
    0
  ),
  discount_per_unit_dkk = GREATEST(
    (s.total_discount_dkk -
      GREATEST(
        ((GREATEST(pm.price, pm.compare_at_price) / (1 + COALESCE(s.tax_rate, 0.077))) - s.price_dkk) * s.quantity,
        0
      )
    ) / s.quantity,
    0
  )
FROM product_metadata_chf pm
WHERE s.shop = 'pompdelux-chf.myshopify.com'
  AND (s.sku = pm.sku OR REPLACE(s.sku, '/', '\') = pm.sku)
  AND pm.compare_at_price IS NOT NULL;

-- Show summary
SELECT
  'pompdelux-da.myshopify.com' as shop,
  COUNT(*) as total_skus,
  COUNT(*) FILTER (WHERE original_price_dkk > price_dkk) as skus_with_sale_discount,
  COUNT(*) FILTER (WHERE discount_per_unit_dkk > 0) as skus_with_order_discount
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com';
