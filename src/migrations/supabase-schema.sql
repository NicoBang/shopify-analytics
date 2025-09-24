-- Supabase Database Schema for Shopify Analytics
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Orders table (optimeret struktur)
CREATE TABLE orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  country VARCHAR(10),
  discounted_total DECIMAL(10,2),
  tax DECIMAL(10,2),
  shipping DECIMAL(10,2),
  item_count INTEGER DEFAULT 0,
  refunded_amount DECIMAL(10,2) DEFAULT 0,
  refunded_qty INTEGER DEFAULT 0,
  refund_date TIMESTAMPTZ,
  total_discounts_ex_tax DECIMAL(10,2) DEFAULT 0,
  cancelled_qty INTEGER DEFAULT 0,
  raw_data JSONB,
  UNIQUE(shop, order_id)
);

-- SKU table
CREATE TABLE skus (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  sku VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  country VARCHAR(10),
  product_title TEXT,
  variant_title TEXT,
  quantity INTEGER DEFAULT 0,
  refunded_qty INTEGER DEFAULT 0,
  price_dkk DECIMAL(10,2),
  refund_date TIMESTAMPTZ,
  UNIQUE(shop, order_id, sku)
);

-- Inventory table
CREATE TABLE inventory (
  sku VARCHAR(200) PRIMARY KEY,
  quantity INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Product metadata table
CREATE TABLE product_metadata (
  sku VARCHAR(200) PRIMARY KEY,
  product_title TEXT,
  variant_title TEXT,
  status VARCHAR(50),
  cost DECIMAL(10,2),
  program VARCHAR(100),
  produkt VARCHAR(200),
  farve VARCHAR(100),
  artikelnummer VARCHAR(100),
  season VARCHAR(50),
  gender VARCHAR(20),
  størrelse VARCHAR(20),
  varemodtaget INTEGER DEFAULT 0,
  kostpris DECIMAL(10,2),
  stamvarenummer VARCHAR(100),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Fulfillments table
CREATE TABLE fulfillments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  country VARCHAR(10),
  carrier VARCHAR(100),
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync log table (til tracking)
CREATE TABLE sync_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100),
  sync_type VARCHAR(50),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  status VARCHAR(20) DEFAULT 'running'
);

-- Indexes for performance
CREATE INDEX idx_orders_shop_created ON orders(shop, created_at DESC);
CREATE INDEX idx_orders_dates ON orders(created_at DESC, updated_at DESC);
CREATE INDEX idx_skus_shop_created ON skus(shop, created_at DESC);
CREATE INDEX idx_skus_sku ON skus(sku);
CREATE INDEX idx_fulfillments_date ON fulfillments(date DESC);
CREATE INDEX idx_sync_log_shop ON sync_log(shop, started_at DESC);

-- Views for analytics
CREATE VIEW order_analytics AS
SELECT
  shop,
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as order_count,
  SUM(discounted_total) as total_revenue,
  SUM(refunded_amount) as total_refunded,
  AVG(discounted_total) as avg_order_value
FROM orders
GROUP BY shop, DATE_TRUNC('day', created_at);

-- Function to clean old sync logs
CREATE OR REPLACE FUNCTION clean_old_sync_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM sync_log
  WHERE started_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;