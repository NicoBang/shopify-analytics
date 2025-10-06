-- Add refunded_amount_dkk column to distinguish refunds from cancellations
ALTER TABLE skus ADD COLUMN IF NOT EXISTS refunded_amount_dkk NUMERIC DEFAULT 0;

-- Add comment to clarify field usage
COMMENT ON COLUMN skus.refunded_amount_dkk IS 'Total refunded amount in DKK (post-order refunds)';
COMMENT ON COLUMN skus.cancelled_amount_dkk IS 'Total cancelled amount in DKK (pre-shipment cancellations only)';

-- Create index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_skus_refunded_amount ON skus(refunded_amount_dkk) WHERE refunded_amount_dkk > 0;

-- Reset cancelled_amount_dkk where it was incorrectly populated by refunds
-- (where cancelled_qty = 0 but cancelled_amount_dkk > 0)
UPDATE skus 
SET cancelled_amount_dkk = 0
WHERE cancelled_qty = 0 AND cancelled_amount_dkk > 0;
