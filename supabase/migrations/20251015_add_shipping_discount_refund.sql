-- Migration: Add shipping_discount and shipping_refund columns to daily_shop_metrics
-- Date: 2025-10-15
-- Session 7: Refund Date Separation Fix
-- Purpose: Track shipping discounts and refunds separately with correct date attribution

-- Add shipping_discount column (based on created_at)
ALTER TABLE daily_shop_metrics
ADD COLUMN IF NOT EXISTS shipping_discount NUMERIC(12,2) DEFAULT 0;

-- Add shipping_refund column (based on refund_date)
ALTER TABLE daily_shop_metrics
ADD COLUMN IF NOT EXISTS shipping_refund NUMERIC(12,2) DEFAULT 0;

-- Add comments
COMMENT ON COLUMN daily_shop_metrics.shipping_discount IS 'Shipping discounts from orders created on this date (DKK ex VAT)';
COMMENT ON COLUMN daily_shop_metrics.shipping_refund IS 'Shipping refunds that occurred on this date based on refund_date (DKK ex VAT)';

-- Update existing rows to have 0 for these new columns
UPDATE daily_shop_metrics SET shipping_discount = 0 WHERE shipping_discount IS NULL;
UPDATE daily_shop_metrics SET shipping_refund = 0 WHERE shipping_refund IS NULL;
