-- Migration: Create daily_sku_transactions table for V2 Color Analytics
-- Purpose: Store SKU-level transaction data with full granularity (including size/variant)
-- Replaces: daily_color_metrics, daily_sku_metrics, daily_number_metrics (too coarse)

-- Drop old tables that had incorrect granularity
DROP TABLE IF EXISTS daily_color_metrics CASCADE;
DROP TABLE IF EXISTS daily_sku_metrics CASCADE;
DROP TABLE IF EXISTS daily_number_metrics CASCADE;

-- Create new SKU-level transaction aggregation table
CREATE TABLE daily_sku_transactions (
  shop TEXT NOT NULL,
  metric_date DATE NOT NULL,
  sku TEXT NOT NULL,  -- Full SKU with size (e.g., "100515\216/122")

  -- Quantity metrics
  quantity_gross INTEGER DEFAULT 0,     -- Total ordered (before cancellations)
  quantity_net INTEGER DEFAULT 0,       -- Net after cancellations (before returns)
  quantity_returned INTEGER DEFAULT 0,  -- Returned quantity
  quantity_cancelled INTEGER DEFAULT 0, -- Cancelled quantity

  -- Revenue metrics (all in DKK, EX VAT)
  revenue_gross NUMERIC(10,2) DEFAULT 0,      -- Gross revenue (price_dkk × quantity_gross)
  revenue_net NUMERIC(10,2) DEFAULT 0,        -- Net after cancellations
  refunded_amount NUMERIC(10,2) DEFAULT 0,    -- Total refunded
  cancelled_amount NUMERIC(10,2) DEFAULT 0,   -- Total cancelled

  -- Discount metrics (all in DKK, EX VAT)
  order_discounts NUMERIC(10,2) DEFAULT 0,    -- Order-level discounts
  sale_discounts NUMERIC(10,2) DEFAULT 0,     -- Sale/campaign discounts
  total_discounts NUMERIC(10,2) DEFAULT 0,    -- Sum of all discounts

  -- Cost metrics (populated separately from metadata)
  avg_cost_dkk NUMERIC(10,2),                 -- Average cost per unit
  total_cost NUMERIC(10,2),                   -- Total cost (avg_cost × quantity_net)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (shop, metric_date, sku)
);

-- Indexes for fast queries
CREATE INDEX idx_daily_sku_transactions_date ON daily_sku_transactions(metric_date);
CREATE INDEX idx_daily_sku_transactions_shop_date ON daily_sku_transactions(shop, metric_date);
CREATE INDEX idx_daily_sku_transactions_sku ON daily_sku_transactions(sku);

-- Comments for documentation
COMMENT ON TABLE daily_sku_transactions IS 'Daily aggregated SKU-level transaction data for V2 analytics. Preserves full SKU granularity (with size/variant) to enable flexible grouping by color, artikelnummer, etc.';
COMMENT ON COLUMN daily_sku_transactions.sku IS 'Full SKU including size/variant (e.g., "100515\216/122"). NOT truncated to artikelnummer.';
COMMENT ON COLUMN daily_sku_transactions.revenue_gross IS 'Gross revenue = price_dkk × quantity_gross. Price already includes sale discounts per CLAUDE.md.';
COMMENT ON COLUMN daily_sku_transactions.revenue_net IS 'Net revenue after cancellations = revenue_gross - cancelled_amount.';
COMMENT ON COLUMN daily_sku_transactions.total_discounts IS 'Sum of order_discounts + sale_discounts for transparency.';
