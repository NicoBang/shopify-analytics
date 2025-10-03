-- Migration: Create order_webhooks table for Shopify webhook events
-- Date: 2025-10-03
-- Purpose: Store webhook payloads from Shopify orders/create and orders/updated events

-- Forward Migration
CREATE TABLE IF NOT EXISTS order_webhooks (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT order_webhooks_shop_not_empty CHECK (shop <> ''),
  CONSTRAINT order_webhooks_event_type_not_empty CHECK (event_type <> ''),
  CONSTRAINT order_webhooks_order_id_not_empty CHECK (order_id <> '')
);

-- Indexes for performance
CREATE INDEX idx_order_webhooks_shop ON order_webhooks(shop);
CREATE INDEX idx_order_webhooks_created_at ON order_webhooks(created_at DESC);
CREATE INDEX idx_order_webhooks_processed ON order_webhooks(processed) WHERE processed = false;
CREATE INDEX idx_order_webhooks_event_type ON order_webhooks(event_type);
CREATE INDEX idx_order_webhooks_order_id ON order_webhooks(order_id);

-- Comments for documentation
COMMENT ON TABLE order_webhooks IS 'Stores webhook events from Shopify for orders/create and orders/updated topics';
COMMENT ON COLUMN order_webhooks.shop IS 'Shopify shop domain (e.g., pompdelux-da.myshopify.com)';
COMMENT ON COLUMN order_webhooks.event_type IS 'Webhook topic (e.g., orders/create, orders/updated)';
COMMENT ON COLUMN order_webhooks.order_id IS 'Shopify order ID as string';
COMMENT ON COLUMN order_webhooks.payload IS 'Full webhook payload from Shopify in JSONB format';
COMMENT ON COLUMN order_webhooks.processed IS 'Whether webhook has been processed into orders table';
COMMENT ON COLUMN order_webhooks.processed_at IS 'Timestamp when webhook was processed';

-- Rollback Migration (run this to undo the migration)
-- DROP INDEX IF EXISTS idx_order_webhooks_order_id;
-- DROP INDEX IF EXISTS idx_order_webhooks_event_type;
-- DROP INDEX IF EXISTS idx_order_webhooks_processed;
-- DROP INDEX IF EXISTS idx_order_webhooks_created_at;
-- DROP INDEX IF EXISTS idx_order_webhooks_shop;
-- DROP TABLE IF EXISTS order_webhooks;
