-- Migration: Add sale discount columns to skus table
-- Purpose: Track markdown/sale price reductions (compareAtPrice - salePrice)
-- Date: 2025-10-07

-- Add original_price_dkk column (compareAtPrice from Shopify)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS original_price_dkk NUMERIC DEFAULT 0;

-- Add sale_discount_per_unit_dkk column (originalPrice - discountedPrice per unit)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS sale_discount_per_unit_dkk NUMERIC DEFAULT 0;

-- Add sale_discount_total_dkk column (sale_discount_per_unit_dkk * quantity)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS sale_discount_total_dkk NUMERIC DEFAULT 0;

-- Add comments to explain the columns
COMMENT ON COLUMN skus.original_price_dkk IS 'Original retail price (compareAtPrice) per unit in DKK ex tax, from Shopify LineItem.originalUnitPriceSet';
COMMENT ON COLUMN skus.sale_discount_per_unit_dkk IS 'Sale markdown per unit in DKK ex tax, calculated as max(original_price_dkk - price_dkk, 0)';
COMMENT ON COLUMN skus.sale_discount_total_dkk IS 'Total sale markdown for all units in DKK ex tax, calculated as sale_discount_per_unit_dkk * quantity';

-- Update existing rows to have 0 as default
UPDATE skus
SET
  original_price_dkk = 0,
  sale_discount_per_unit_dkk = 0,
  sale_discount_total_dkk = 0
WHERE original_price_dkk IS NULL
   OR sale_discount_per_unit_dkk IS NULL
   OR sale_discount_total_dkk IS NULL;
