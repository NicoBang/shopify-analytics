-- Migration: Fix price_dkk directly in database without re-syncing
-- Purpose: Recalculate price_dkk for quantity > 1 records using existing data
-- Date: 2025-10-07
--
-- IMPORTANT: This assumes the BUG was that we divided by quantity AFTER removing tax
-- If actual bug was different, this won't work correctly

-- First, let's analyze the problem with a sample
DO $$
DECLARE
  sample_record RECORD;
BEGIN
  RAISE NOTICE '🔍 Analyzing sample multi-quantity records...';

  FOR sample_record IN (
    SELECT order_id, sku, quantity, price_dkk,
           ROUND(price_dkk * quantity, 2) as total_price
    FROM skus
    WHERE quantity > 1
    LIMIT 5
  )
  LOOP
    RAISE NOTICE '   Order %, SKU %: qty=%, price_dkk=%, total=%',
      sample_record.order_id,
      sample_record.sku,
      sample_record.quantity,
      sample_record.price_dkk,
      sample_record.total_price;
  END LOOP;
END $$;

-- STOP HERE - DO NOT RUN THE UPDATE YET
-- We need to verify the math first by checking actual Shopify orders
