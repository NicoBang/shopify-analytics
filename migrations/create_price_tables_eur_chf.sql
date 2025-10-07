-- Migration: Create EUR and CHF price tables
-- Purpose: Store compare_at_price for EUR and CHF shops separately
-- Date: 2025-10-07

-- EUR price table (used by DE, INT, NL shops)
CREATE TABLE IF NOT EXISTS product_prices_eur (
  sku TEXT PRIMARY KEY,
  price NUMERIC NOT NULL DEFAULT 0,
  compare_at_price NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE product_prices_eur IS 'Product prices in EUR (INCL TAX) for DE, INT, NL shops';
COMMENT ON COLUMN product_prices_eur.sku IS 'SKU identifier';
COMMENT ON COLUMN product_prices_eur.price IS 'Current price in EUR (INCL 19% VAT for DE/NL, 25% for INT)';
COMMENT ON COLUMN product_prices_eur.compare_at_price IS 'Original/compare-at price in EUR (INCL TAX)';

-- CHF price table (used by CHF shop)
CREATE TABLE IF NOT EXISTS product_prices_chf (
  sku TEXT PRIMARY KEY,
  price NUMERIC NOT NULL DEFAULT 0,
  compare_at_price NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE product_prices_chf IS 'Product prices in CHF (INCL TAX) for CHF shop';
COMMENT ON COLUMN product_prices_chf.sku IS 'SKU identifier';
COMMENT ON COLUMN product_prices_chf.price IS 'Current price in CHF (INCL TAX)';
COMMENT ON COLUMN product_prices_chf.compare_at_price IS 'Original/compare-at price in CHF (INCL TAX)';

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_prices_eur_sku ON product_prices_eur(sku);
CREATE INDEX IF NOT EXISTS idx_product_prices_chf_sku ON product_prices_chf(sku);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON product_prices_eur TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON product_prices_chf TO authenticated, anon, service_role;
