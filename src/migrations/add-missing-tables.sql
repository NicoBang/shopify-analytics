-- Migration: Add missing tables and relationships for enhanced analytics
-- Run this in your Supabase SQL Editor after the main schema

-- Update product_metadata table with all columns from original system
ALTER TABLE product_metadata
ADD COLUMN IF NOT EXISTS tags TEXT,
ADD COLUMN IF NOT EXISTS price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2);

-- Add foreign key relationship between inventory and product_metadata
-- Note: This assumes SKUs exist in both tables
-- If not, add the relationship after data is populated

-- Update fulfillments table to include shop information
ALTER TABLE fulfillments
ADD COLUMN IF NOT EXISTS shop VARCHAR(100);

-- Create indexes for better performance on new relationships
CREATE INDEX IF NOT EXISTS idx_inventory_metadata ON inventory(sku);
CREATE INDEX IF NOT EXISTS idx_product_metadata_sku ON product_metadata(sku);
CREATE INDEX IF NOT EXISTS idx_skus_metadata_lookup ON skus(sku);

-- Add fulfillments indexes
CREATE INDEX IF NOT EXISTS idx_fulfillments_shop ON fulfillments(shop);
CREATE INDEX IF NOT EXISTS idx_fulfillments_carrier ON fulfillments(carrier);
CREATE INDEX IF NOT EXISTS idx_fulfillments_country ON fulfillments(country);

-- Create view for inventory with metadata (alternative to JOIN)
CREATE OR REPLACE VIEW inventory_with_metadata AS
SELECT
  i.sku,
  i.quantity,
  i.last_updated,
  pm.product_title,
  pm.variant_title,
  pm.status,
  pm.cost,
  pm.program,
  pm.produkt,
  pm.farve,
  pm.season,
  pm.gender,
  pm.størrelse,
  pm.price,
  pm.compare_at_price,
  pm.tags
FROM inventory i
LEFT JOIN product_metadata pm ON i.sku = pm.sku;

-- Create enhanced SKU analytics view
CREATE OR REPLACE VIEW sku_analytics AS
SELECT
  s.sku,
  s.shop,
  s.product_title,
  s.variant_title,
  COUNT(*) as order_count,
  SUM(s.quantity) as total_quantity,
  SUM(s.refunded_qty) as total_refunded,
  SUM(s.price_dkk * s.quantity) as total_revenue,
  AVG(s.price_dkk) as avg_price,
  STRING_AGG(DISTINCT s.country, ', ') as countries,
  MIN(s.created_at) as first_sale,
  MAX(s.created_at) as last_sale,
  pm.status,
  pm.program,
  pm.produkt,
  pm.farve,
  pm.season,
  pm.gender
FROM skus s
LEFT JOIN product_metadata pm ON s.sku = pm.sku
GROUP BY s.sku, s.shop, s.product_title, s.variant_title,
         pm.status, pm.program, pm.produkt, pm.farve, pm.season, pm.gender;

-- Create comprehensive analytics view
CREATE OR REPLACE VIEW comprehensive_analytics AS
SELECT
  o.shop,
  DATE_TRUNC('day', o.created_at) as date,
  COUNT(*) as order_count,
  SUM(o.discounted_total) as revenue,
  SUM(o.refunded_amount) as refunds,
  SUM(o.tax) as tax_total,
  SUM(o.shipping) as shipping_total,
  SUM(o.sale_discount_total) as sale_discounts,
  SUM(o.combined_discount_total) as total_discounts,
  AVG(o.discounted_total) as avg_order_value,
  SUM(o.item_count) as items_sold
FROM orders o
GROUP BY o.shop, DATE_TRUNC('day', o.created_at);

-- Function to get top SKUs by revenue
CREATE OR REPLACE FUNCTION get_top_skus_by_revenue(
  p_shop VARCHAR DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  sku VARCHAR,
  product_title TEXT,
  total_quantity BIGINT,
  total_revenue DECIMAL,
  order_count BIGINT,
  avg_price DECIMAL,
  refund_rate DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sku,
    s.product_title,
    SUM(s.quantity) as total_quantity,
    SUM(s.price_dkk * s.quantity) as total_revenue,
    COUNT(*) as order_count,
    AVG(s.price_dkk) as avg_price,
    CASE
      WHEN SUM(s.quantity) > 0 THEN (SUM(s.refunded_qty)::DECIMAL / SUM(s.quantity) * 100)
      ELSE 0
    END as refund_rate
  FROM skus s
  WHERE (p_shop IS NULL OR s.shop = p_shop)
    AND (p_start_date IS NULL OR s.created_at >= p_start_date)
    AND (p_end_date IS NULL OR s.created_at <= p_end_date)
  GROUP BY s.sku, s.product_title
  ORDER BY total_revenue DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get inventory analytics
CREATE OR REPLACE FUNCTION get_inventory_summary(
  p_low_stock_threshold INTEGER DEFAULT 10
)
RETURNS TABLE (
  total_skus BIGINT,
  total_quantity BIGINT,
  low_stock_count BIGINT,
  out_of_stock_count BIGINT,
  total_value DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_skus,
    SUM(i.quantity) as total_quantity,
    COUNT(*) FILTER (WHERE i.quantity > 0 AND i.quantity <= p_low_stock_threshold) as low_stock_count,
    COUNT(*) FILTER (WHERE i.quantity <= 0) as out_of_stock_count,
    SUM(COALESCE(pm.cost, 0) * i.quantity) as total_value
  FROM inventory i
  LEFT JOIN product_metadata pm ON i.sku = pm.sku;
END;
$$ LANGUAGE plpgsql;