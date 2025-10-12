-- Migration: Add tax_rate columns to orders and skus tables
-- Purpose: Store actual tax rate from Shopify taxLines for accurate EX VAT calculations
-- Date: 2025-10-12

-- Add tax_rate to orders table (already has tax_rate column but may be null)
-- This column will store the actual VAT rate from Shopify (e.g., 0.25 for 25%, 0.19 for 19%)
COMMENT ON COLUMN orders.tax_rate IS 'Actual VAT rate from Shopify taxLines (decimal format: 0.25 = 25%)';

-- Add tax_rate to skus table
ALTER TABLE skus ADD COLUMN IF NOT EXISTS tax_rate NUMERIC;

COMMENT ON COLUMN skus.tax_rate IS 'VAT rate copied from parent order (decimal format: 0.25 = 25%)';

-- Create index for efficient joins and filtering
CREATE INDEX IF NOT EXISTS idx_skus_tax_rate ON skus(tax_rate) WHERE tax_rate IS NOT NULL;

-- Note: Historical data will need backfill after orders.tax_rate is populated
