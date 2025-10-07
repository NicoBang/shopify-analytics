-- Migration: Create SKU price verification table
-- Purpose: Temporary table to sync correct prices and compare with existing data
-- Date: 2025-10-07

CREATE TABLE IF NOT EXISTS sku_price_verification (
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_dkk NUMERIC NOT NULL,
  original_price_dkk NUMERIC DEFAULT 0,
  total_discount_dkk NUMERIC DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (shop, order_id, sku)
);

COMMENT ON TABLE sku_price_verification IS 'Temporary table to verify and fix incorrect SKU prices from bulk-sync-skus bug';
COMMENT ON COLUMN sku_price_verification.price_dkk IS 'Correct price per unit EX TAX in DKK';
COMMENT ON COLUMN sku_price_verification.quantity IS 'Quantity to verify calculation is correct';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sku_price_verification_lookup
ON sku_price_verification(order_id, sku);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON sku_price_verification TO authenticated, anon, service_role;
