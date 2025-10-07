-- Migration: Merge verified SKU prices from verification table
-- Purpose: Fix incorrect price_dkk values caused by tax calculation bug
-- Date: 2025-10-07

-- Step 1: Update skus table with corrected prices from verification table
-- ONLY for records with quantity > 1 (bug only affects multi-quantity orders)
UPDATE skus s
SET
  price_dkk = v.price_dkk,
  original_price_dkk = v.original_price_dkk,
  total_discount_dkk = v.total_discount_dkk
FROM sku_price_verification v
WHERE s.shop = v.shop
  AND s.order_id = v.order_id
  AND s.sku = v.sku
  AND s.quantity = v.quantity  -- Extra safety check
  AND s.quantity > 1  -- Bug only affects multi-quantity orders
  AND ABS(s.price_dkk - v.price_dkk) > 0.01;  -- Only update if different

-- Step 2: Verification report
DO $$
DECLARE
  total_records_updated INTEGER;
  total_records_checked INTEGER;
  sample_corrections TEXT;
BEGIN
  -- Count how many were actually different
  SELECT COUNT(*) INTO total_records_checked
  FROM sku_price_verification;

  SELECT COUNT(*) INTO total_records_updated
  FROM skus s
  INNER JOIN sku_price_verification v ON s.shop = v.shop AND s.order_id = v.order_id AND s.sku = v.sku
  WHERE s.quantity > 1 AND ABS(s.price_dkk - v.price_dkk) > 0.01;

  -- Get sample of corrections
  SELECT string_agg(
    format('Order %s, SKU %s (qty %s): %s → %s DKK',
      s.order_id,
      s.sku,
      s.quantity,
      ROUND(s.price_dkk, 2),
      ROUND(v.price_dkk, 2)
    ), E'\n   '
  ) INTO sample_corrections
  FROM skus s
  INNER JOIN sku_price_verification v ON s.shop = v.shop AND s.order_id = v.order_id AND s.sku = v.sku
  WHERE s.quantity > 1 AND ABS(s.price_dkk - v.price_dkk) > 0.01
  LIMIT 5;

  RAISE NOTICE '✅ Merge verification complete:';
  RAISE NOTICE '   - Total verification records: %', total_records_checked;
  RAISE NOTICE '   - Records updated: %', total_records_updated;
  RAISE NOTICE '   - Records unchanged: %', total_records_checked - total_records_updated;
  RAISE NOTICE '';
  RAISE NOTICE 'Sample corrections:';
  RAISE NOTICE '   %', COALESCE(sample_corrections, 'None - all prices were already correct');
END $$;
