-- Migration: Add missing discount columns
-- Adds saleDiscountTotal and combinedDiscountTotal columns to match original system

ALTER TABLE orders
ADD COLUMN sale_discount_total DECIMAL(10,2) DEFAULT 0,
ADD COLUMN combined_discount_total DECIMAL(10,2) DEFAULT 0;

-- Add comments for clarity
COMMENT ON COLUMN orders.sale_discount_total IS 'Direct product discounts/sales';
COMMENT ON COLUMN orders.combined_discount_total IS 'Total combined discounts (sale + other)';

-- Add index for performance on discount queries
CREATE INDEX idx_orders_sale_discount ON orders(sale_discount_total) WHERE sale_discount_total > 0;
CREATE INDEX idx_orders_combined_discount ON orders(combined_discount_total) WHERE combined_discount_total > 0;