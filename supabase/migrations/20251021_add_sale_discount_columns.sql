-- Add separate columns for order discounts and sale discounts
-- This allows us to distinguish between:
-- 1. Order-level discounts (discount codes, automatic discounts) -> order_discount_total
-- 2. Sale/campaign discounts (compareAtPrice - price) -> sale_discount_total
--
-- Previously: only had total_discounts = order_discount + sale_discount combined
-- Now: track them separately for accurate bruttoomsætning calculation

ALTER TABLE daily_shop_metrics
ADD COLUMN IF NOT EXISTS order_discount_total NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS sale_discount_total NUMERIC DEFAULT 0;

COMMENT ON COLUMN daily_shop_metrics.order_discount_total IS 'Sum of discount_per_unit_dkk * quantity (order-level discounts from codes/automatic)';
COMMENT ON COLUMN daily_shop_metrics.sale_discount_total IS 'Sum of sale_discount_per_unit_dkk * quantity (sale/campaign discounts from compareAtPrice)';
COMMENT ON COLUMN daily_shop_metrics.total_discounts IS 'DEPRECATED: Use order_discount_total + sale_discount_total instead. Sum of all discounts.';

-- Backfill existing data: split total_discounts equally (we don't have historical breakdown)
-- This is temporary - future aggregations will use the correct split
UPDATE daily_shop_metrics
SET
  order_discount_total = total_discounts / 2,
  sale_discount_total = total_discounts / 2
WHERE order_discount_total = 0 AND sale_discount_total = 0;
