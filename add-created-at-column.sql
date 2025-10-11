-- Add created_at column to order_sequence_validation
-- This stores the Shopify order creation timestamp

-- Add column
ALTER TABLE order_sequence_validation
ADD COLUMN created_at TIMESTAMPTZ;

-- Add comment
COMMENT ON COLUMN order_sequence_validation.created_at IS
    'Shopify order creation timestamp (from createdAt field)';

-- Optional: Add index for date-based queries
CREATE INDEX idx_order_seq_created_at ON order_sequence_validation(shop, created_at);
