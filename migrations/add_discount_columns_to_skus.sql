-- Add discount columns to skus table
-- Migration: 2025-10-01 - Add total_discount_dkk and discount_per_unit_dkk

-- Add total_discount_dkk column (total discount allocated to this line item)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS total_discount_dkk NUMERIC DEFAULT 0;

-- Add discount_per_unit_dkk column (discount per single unit)
ALTER TABLE skus
ADD COLUMN IF NOT EXISTS discount_per_unit_dkk NUMERIC DEFAULT 0;

-- Add comment to explain the columns
COMMENT ON COLUMN skus.total_discount_dkk IS 'Total discount allocated to this line item (all units combined) in DKK, from Shopify LineItem.totalDiscountSet';
COMMENT ON COLUMN skus.discount_per_unit_dkk IS 'Discount per unit in DKK, calculated as total_discount_dkk / quantity';

-- Update existing rows to have 0 as default
UPDATE skus
SET total_discount_dkk = 0, discount_per_unit_dkk = 0
WHERE total_discount_dkk IS NULL OR discount_per_unit_dkk IS NULL;
