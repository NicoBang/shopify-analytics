-- ============================================================
-- Materialized View: skus_order_index
-- ============================================================
-- Purpose: Fast lookup of unique order_ids from skus table
-- Why: skus table has ~200k rows with avg 11 SKUs per order
--      This materialized view contains only ~18k unique order_ids
-- Performance: 10x faster lookups for existence checks
-- ============================================================

-- Create materialized view with unique order_ids from skus
CREATE MATERIALIZED VIEW IF NOT EXISTS skus_order_index AS
SELECT DISTINCT
    shop,
    order_id
FROM skus;

-- Add unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_order_index_unique
ON skus_order_index(shop, order_id);

-- Add comment
COMMENT ON MATERIALIZED VIEW skus_order_index IS
    'Materialized view containing unique order_ids from skus table for fast existence checks';

-- ============================================================
-- Function: refresh_skus_order_index
-- ============================================================
-- Purpose: Refresh the materialized view after SKU syncs
-- Usage: Call after bulk-sync-skus completes
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_skus_order_index()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY skus_order_index;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_skus_order_index IS
    'Refreshes the skus_order_index materialized view. Call after bulk SKU syncs.';
