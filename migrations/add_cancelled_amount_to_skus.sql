-- Add cancelled_amount_dkk to skus table
-- Migration: 2025-10-03 - Track exact cancelled amounts at line item level using RefundLineItem.priceSet

-- Problem: Previously, cancelled items were deducted from bruttoomsætning using proportional calculation
-- (brutto / itemCount) * cancelledQty, which gave incorrect results when expensive/cheap items were cancelled.

-- Solution: Store exact cancelled amount from Shopify's RefundLineItem.priceSet.shopMoney.amount
-- This gives us the PRECISE price of each cancelled item, not an average.

ALTER TABLE skus
ADD COLUMN IF NOT EXISTS cancelled_amount_dkk NUMERIC DEFAULT 0;

COMMENT ON COLUMN skus.cancelled_amount_dkk IS 'Total amount in DKK for cancelled items on this line (from RefundLineItem.priceSet when refund totalRefundedSet.amount = 0). Calculated as: cancelled_unit_price * cancelled_qty * currency_rate.';

-- Update existing rows to have 0 as default
UPDATE skus
SET cancelled_amount_dkk = 0
WHERE cancelled_amount_dkk IS NULL;

-- Validation query to check data after backfill:
-- SELECT order_id, sku, quantity, cancelled_qty, cancelled_amount_dkk, price_dkk
-- FROM skus
-- WHERE cancelled_qty > 0
-- ORDER BY cancelled_amount_dkk DESC
-- LIMIT 20;
