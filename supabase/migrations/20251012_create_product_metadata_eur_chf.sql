-- Migration: Create product_metadata_eur and product_metadata_chf tables
-- Purpose: Support multi-currency product metadata for EUR and CHF shops
-- Date: 2025-10-12

-- Create product_metadata_eur table (for DE, NL, INT shops)
CREATE TABLE IF NOT EXISTS product_metadata_eur (
  sku TEXT PRIMARY KEY,
  product_title TEXT,
  variant_title TEXT,
  price NUMERIC,  -- EUR price INCL VAT
  compare_at_price NUMERIC,  -- EUR "before sale" price INCL VAT
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create product_metadata_chf table (for CHF shop)
CREATE TABLE IF NOT EXISTS product_metadata_chf (
  sku TEXT PRIMARY KEY,
  product_title TEXT,
  variant_title TEXT,
  price NUMERIC,  -- CHF price INCL VAT
  compare_at_price NUMERIC,  -- CHF "before sale" price INCL VAT
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_metadata_eur_sku ON product_metadata_eur(sku);
CREATE INDEX IF NOT EXISTS idx_product_metadata_chf_sku ON product_metadata_chf(sku);

-- Add comments
COMMENT ON TABLE product_metadata_eur IS 'Product metadata for EUR shops (DE, NL, INT) with prices INCL VAT';
COMMENT ON TABLE product_metadata_chf IS 'Product metadata for CHF shop with prices INCL VAT';

COMMENT ON COLUMN product_metadata_eur.price IS 'Current selling price in EUR (INCL VAT)';
COMMENT ON COLUMN product_metadata_eur.compare_at_price IS 'List price / "før pris" in EUR (INCL VAT)';
COMMENT ON COLUMN product_metadata_chf.price IS 'Current selling price in CHF (INCL VAT)';
COMMENT ON COLUMN product_metadata_chf.compare_at_price IS 'List price / "før pris" in CHF (INCL VAT)';
