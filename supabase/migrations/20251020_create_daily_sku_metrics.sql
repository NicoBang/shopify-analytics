-- Create daily_sku_metrics table for SKU-level (with size) aggregated analytics
-- Similar to daily_color_metrics but broken down by size (SKU level)

CREATE TABLE IF NOT EXISTS daily_sku_metrics (
  metric_date DATE NOT NULL,
  sku TEXT NOT NULL,
  artikelnummer TEXT NOT NULL,
  program TEXT,
  produkt TEXT,
  farve TEXT,
  stoerrelse TEXT,  -- Size from variant_title
  season TEXT,
  gender TEXT,  -- JSON array as text
  solgt INTEGER DEFAULT 0,
  retur INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  omsaetning_net NUMERIC(10,2) DEFAULT 0,
  refunded_amount NUMERIC(10,2) DEFAULT 0,
  shops TEXT,  -- Comma-separated list of shops if needed
  varemodtaget INTEGER DEFAULT 0,
  kostpris NUMERIC(10,2) DEFAULT 0,  -- Total cost (not per-unit)
  status TEXT,
  tags TEXT,
  vejl_pris NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (metric_date, sku)
);

-- Indexes for performance
CREATE INDEX idx_daily_sku_metrics_date ON daily_sku_metrics(metric_date);
CREATE INDEX idx_daily_sku_metrics_artikelnummer ON daily_sku_metrics(artikelnummer);
CREATE INDEX idx_daily_sku_metrics_sku ON daily_sku_metrics(sku);
CREATE INDEX idx_daily_sku_metrics_season ON daily_sku_metrics(season);

-- Comments
COMMENT ON TABLE daily_sku_metrics IS 'Pre-aggregated daily SKU-level metrics (broken down by size) for fast SKU Analytics queries';
COMMENT ON COLUMN daily_sku_metrics.metric_date IS 'Date for aggregated metrics';
COMMENT ON COLUMN daily_sku_metrics.sku IS 'Full SKU including size (e.g., 100679\267/104)';
COMMENT ON COLUMN daily_sku_metrics.artikelnummer IS 'Article number without size (e.g., 100679)';
COMMENT ON COLUMN daily_sku_metrics.stoerrelse IS 'Size from variant_title (e.g., 104, 110/116)';
COMMENT ON COLUMN daily_sku_metrics.solgt IS 'Total quantity sold (excluding refunds and cancellations)';
COMMENT ON COLUMN daily_sku_metrics.retur IS 'Total quantity returned';
COMMENT ON COLUMN daily_sku_metrics.cancelled IS 'Total quantity cancelled';
COMMENT ON COLUMN daily_sku_metrics.omsaetning_net IS 'Net revenue (after refunds and cancellations) in DKK';
COMMENT ON COLUMN daily_sku_metrics.kostpris IS 'Total cost (sum of per-unit cost * quantity) in DKK';
COMMENT ON COLUMN daily_sku_metrics.varemodtaget IS 'Inventory received (from product_metadata)';
