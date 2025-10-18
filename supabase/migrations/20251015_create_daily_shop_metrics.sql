-- Migration: Create daily_shop_metrics table for instant dashboard
-- Date: 2025-10-15
-- Purpose: Pre-aggregate daily metrics per shop for <2 second dashboard response

-- Create daily_shop_metrics table
CREATE TABLE IF NOT EXISTS daily_shop_metrics (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  metric_date DATE NOT NULL,

  -- Order metrics
  order_count INTEGER DEFAULT 0,

  -- Revenue metrics (DKK, ex VAT)
  revenue_gross NUMERIC(12,2) DEFAULT 0,
  revenue_net NUMERIC(12,2) DEFAULT 0,

  -- SKU metrics
  sku_quantity_gross INTEGER DEFAULT 0,
  sku_quantity_net INTEGER DEFAULT 0,

  -- Return metrics
  return_quantity INTEGER DEFAULT 0,
  return_amount NUMERIC(12,2) DEFAULT 0,
  return_order_count INTEGER DEFAULT 0,

  -- Cancelled metrics
  cancelled_quantity INTEGER DEFAULT 0,
  cancelled_amount NUMERIC(12,2) DEFAULT 0,

  -- Shipping & discounts
  shipping_revenue NUMERIC(12,2) DEFAULT 0,
  total_discounts NUMERIC(12,2) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per shop per day
  UNIQUE(shop, metric_date)
);

-- Create indexes for fast queries
CREATE INDEX idx_daily_shop_metrics_shop ON daily_shop_metrics(shop);
CREATE INDEX idx_daily_shop_metrics_date ON daily_shop_metrics(metric_date);
CREATE INDEX idx_daily_shop_metrics_shop_date ON daily_shop_metrics(shop, metric_date);

-- Add comments
COMMENT ON TABLE daily_shop_metrics IS 'Pre-aggregated daily metrics per shop for instant dashboard performance (<2s)';
COMMENT ON COLUMN daily_shop_metrics.metric_date IS 'Date for which metrics are aggregated (created_at date from orders)';
COMMENT ON COLUMN daily_shop_metrics.revenue_gross IS 'Total revenue before returns/cancellations (DKK ex VAT)';
COMMENT ON COLUMN daily_shop_metrics.revenue_net IS 'Net revenue after returns/cancellations (DKK ex VAT)';
COMMENT ON COLUMN daily_shop_metrics.sku_quantity_gross IS 'Total SKU quantity sold (before returns)';
COMMENT ON COLUMN daily_shop_metrics.sku_quantity_net IS 'Net SKU quantity (after returns)';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_daily_shop_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_daily_shop_metrics_updated_at
  BEFORE UPDATE ON daily_shop_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_shop_metrics_updated_at();
