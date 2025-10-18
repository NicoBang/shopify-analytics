-- Migration: Create pre-aggregated tables for Color/SKU/Number Analytics
-- Date: 2025-10-15
-- Purpose: Enable <2 second response for style analytics (Color_Analytics, SKU_Analytics, Number_Analytics)

-- ============================================
-- 1. COLOR ANALYTICS (Farve)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_color_metrics (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  metric_date DATE NOT NULL,

  -- Color dimension
  farve TEXT NOT NULL,  -- Color extracted from SKU or product tags

  -- Quantity metrics
  quantity_gross INTEGER DEFAULT 0,
  quantity_net INTEGER DEFAULT 0,
  quantity_returned INTEGER DEFAULT 0,
  quantity_cancelled INTEGER DEFAULT 0,

  -- Revenue metrics (DKK, ex VAT)
  revenue_gross NUMERIC(12,2) DEFAULT 0,
  revenue_net NUMERIC(12,2) DEFAULT 0,
  return_amount NUMERIC(12,2) DEFAULT 0,
  cancelled_amount NUMERIC(12,2) DEFAULT 0,

  -- Discount metrics
  total_discounts NUMERIC(12,2) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per shop/date/color
  UNIQUE(shop, metric_date, farve)
);

-- Indexes for fast queries
CREATE INDEX idx_daily_color_metrics_shop ON daily_color_metrics(shop);
CREATE INDEX idx_daily_color_metrics_date ON daily_color_metrics(metric_date);
CREATE INDEX idx_daily_color_metrics_farve ON daily_color_metrics(farve);
CREATE INDEX idx_daily_color_metrics_shop_date ON daily_color_metrics(shop, metric_date);
CREATE INDEX idx_daily_color_metrics_shop_farve ON daily_color_metrics(shop, farve);

COMMENT ON TABLE daily_color_metrics IS 'Pre-aggregated color metrics for Color_Analytics - enables <2s response time';
COMMENT ON COLUMN daily_color_metrics.farve IS 'Color group: BLACK, WHITE, PINK, NAVY, etc.';


-- ============================================
-- 2. SKU ANALYTICS (Artikelnummer)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_sku_metrics (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  metric_date DATE NOT NULL,

  -- SKU dimension
  artikelnummer TEXT NOT NULL,  -- First 4 digits of SKU

  -- Quantity metrics
  quantity_gross INTEGER DEFAULT 0,
  quantity_net INTEGER DEFAULT 0,
  quantity_returned INTEGER DEFAULT 0,
  quantity_cancelled INTEGER DEFAULT 0,

  -- Revenue metrics (DKK, ex VAT)
  revenue_gross NUMERIC(12,2) DEFAULT 0,
  revenue_net NUMERIC(12,2) DEFAULT 0,
  return_amount NUMERIC(12,2) DEFAULT 0,
  cancelled_amount NUMERIC(12,2) DEFAULT 0,

  -- Discount metrics
  total_discounts NUMERIC(12,2) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per shop/date/artikelnummer
  UNIQUE(shop, metric_date, artikelnummer)
);

-- Indexes for fast queries
CREATE INDEX idx_daily_sku_metrics_shop ON daily_sku_metrics(shop);
CREATE INDEX idx_daily_sku_metrics_date ON daily_sku_metrics(metric_date);
CREATE INDEX idx_daily_sku_metrics_artikelnummer ON daily_sku_metrics(artikelnummer);
CREATE INDEX idx_daily_sku_metrics_shop_date ON daily_sku_metrics(shop, metric_date);
CREATE INDEX idx_daily_sku_metrics_shop_artikelnummer ON daily_sku_metrics(shop, artikelnummer);

COMMENT ON TABLE daily_sku_metrics IS 'Pre-aggregated SKU metrics for SKU_Analytics - enables <2s response time';
COMMENT ON COLUMN daily_sku_metrics.artikelnummer IS 'First 4 digits of SKU (e.g., "5132" from "5132-8-110-51")';


-- ============================================
-- 3. NUMBER ANALYTICS (Number - sidste 2 cifre)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_number_metrics (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  metric_date DATE NOT NULL,

  -- Number dimension
  number TEXT NOT NULL,  -- Last 2 digits of SKU

  -- Quantity metrics
  quantity_gross INTEGER DEFAULT 0,
  quantity_net INTEGER DEFAULT 0,
  quantity_returned INTEGER DEFAULT 0,
  quantity_cancelled INTEGER DEFAULT 0,

  -- Revenue metrics (DKK, ex VAT)
  revenue_gross NUMERIC(12,2) DEFAULT 0,
  revenue_net NUMERIC(12,2) DEFAULT 0,
  return_amount NUMERIC(12,2) DEFAULT 0,
  cancelled_amount NUMERIC(12,2) DEFAULT 0,

  -- Discount metrics
  total_discounts NUMERIC(12,2) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per shop/date/number
  UNIQUE(shop, metric_date, number)
);

-- Indexes for fast queries
CREATE INDEX idx_daily_number_metrics_shop ON daily_number_metrics(shop);
CREATE INDEX idx_daily_number_metrics_date ON daily_number_metrics(metric_date);
CREATE INDEX idx_daily_number_metrics_number ON daily_number_metrics(number);
CREATE INDEX idx_daily_number_metrics_shop_date ON daily_number_metrics(shop, metric_date);
CREATE INDEX idx_daily_number_metrics_shop_number ON daily_number_metrics(shop, number);

COMMENT ON TABLE daily_number_metrics IS 'Pre-aggregated number metrics for Number_Analytics - enables <2s response time';
COMMENT ON COLUMN daily_number_metrics.number IS 'Last 2 digits of SKU (e.g., "51" from "5132-8-110-51")';


-- ============================================
-- 4. UPDATE TRIGGERS
-- ============================================

-- Color metrics trigger
CREATE OR REPLACE FUNCTION update_daily_color_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_color_metrics_updated_at
  BEFORE UPDATE ON daily_color_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_color_metrics_updated_at();

-- SKU metrics trigger
CREATE OR REPLACE FUNCTION update_daily_sku_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_sku_metrics_updated_at
  BEFORE UPDATE ON daily_sku_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_sku_metrics_updated_at();

-- Number metrics trigger
CREATE OR REPLACE FUNCTION update_daily_number_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_number_metrics_updated_at
  BEFORE UPDATE ON daily_number_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_number_metrics_updated_at();
