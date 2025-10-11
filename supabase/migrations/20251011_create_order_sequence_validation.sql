-- ============================================================
-- Order Sequence Validation Table
-- ============================================================
-- Purpose: Track and validate sequential order numbering across shops
-- Use case: Ensure no missing orders (gaps in sequence 1,2,3...N)
-- Related tables: orders, skus
-- ============================================================

-- Drop existing objects if they exist
DROP VIEW IF EXISTS order_sequence_gaps CASCADE;
DROP VIEW IF EXISTS order_sequence_missing_data CASCADE;
DROP TABLE IF EXISTS order_sequence_validation CASCADE;

-- ============================================================
-- Main Table: order_sequence_validation
-- ============================================================
CREATE TABLE order_sequence_validation (
    -- Primary identification
    shop TEXT NOT NULL,
    shopify_order_number BIGINT NOT NULL,
    order_id BIGINT NOT NULL,

    -- Metadata for tracking
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ DEFAULT NOW(),

    -- Data quality flags
    exists_in_orders BOOLEAN DEFAULT FALSE,
    exists_in_skus BOOLEAN DEFAULT FALSE,

    -- Constraints
    PRIMARY KEY (shop, shopify_order_number),
    UNIQUE (shop, order_id),

    -- Validation constraints
    CONSTRAINT positive_order_number CHECK (shopify_order_number > 0),
    CONSTRAINT positive_order_id CHECK (order_id > 0)
);

-- ============================================================
-- Indexes for Performance
-- ============================================================

-- Index for shop-based queries (most common access pattern)
CREATE INDEX idx_order_seq_shop ON order_sequence_validation(shop);

-- Index for order_id lookups
CREATE INDEX idx_order_seq_order_id ON order_sequence_validation(order_id);

-- Index for finding gaps (sequential scanning)
CREATE INDEX idx_order_seq_number ON order_sequence_validation(shop, shopify_order_number);

-- Index for data quality checks
CREATE INDEX idx_order_seq_missing_orders ON order_sequence_validation(shop, exists_in_orders)
    WHERE exists_in_orders = FALSE;
CREATE INDEX idx_order_seq_missing_skus ON order_sequence_validation(shop, exists_in_skus)
    WHERE exists_in_skus = FALSE;

-- Index for verification tracking
CREATE INDEX idx_order_seq_last_verified ON order_sequence_validation(last_verified_at);

-- ============================================================
-- Comments for Documentation
-- ============================================================
COMMENT ON TABLE order_sequence_validation IS
    'Tracks sequential order numbering to detect missing orders across shops';

COMMENT ON COLUMN order_sequence_validation.shop IS
    'Shop identifier (e.g., pompdelux-da.myshopify.com)';

COMMENT ON COLUMN order_sequence_validation.shopify_order_number IS
    'Sequential order number from Shopify (1, 2, 3, ...)';

COMMENT ON COLUMN order_sequence_validation.order_id IS
    'Unique Shopify order ID (numeric)';

COMMENT ON COLUMN order_sequence_validation.exists_in_orders IS
    'Flag: TRUE if order_id exists in orders table';

COMMENT ON COLUMN order_sequence_validation.exists_in_skus IS
    'Flag: TRUE if order_id exists in skus table';

-- ============================================================
-- View: order_sequence_gaps
-- ============================================================
-- Identifies missing sequence numbers (gaps in 1,2,3...N)
-- ============================================================
CREATE OR REPLACE VIEW order_sequence_gaps AS
WITH shop_sequences AS (
    -- Get min/max for each shop
    SELECT
        shop,
        MIN(shopify_order_number) as min_order,
        MAX(shopify_order_number) as max_order,
        COUNT(*) as total_orders
    FROM order_sequence_validation
    GROUP BY shop
),
expected_sequences AS (
    -- Generate complete sequence for each shop
    SELECT
        ss.shop,
        generate_series(ss.min_order, ss.max_order) as expected_order_number,
        ss.total_orders,
        ss.max_order
    FROM shop_sequences ss
)
SELECT
    es.shop,
    es.expected_order_number as missing_order_number,
    es.total_orders as total_orders_in_shop,
    es.max_order as highest_order_number,
    (es.max_order - es.total_orders) as total_gaps
FROM expected_sequences es
LEFT JOIN order_sequence_validation osv
    ON es.shop = osv.shop
    AND es.expected_order_number = osv.shopify_order_number
WHERE osv.shopify_order_number IS NULL
ORDER BY es.shop, es.expected_order_number;

COMMENT ON VIEW order_sequence_gaps IS
    'Identifies missing order sequence numbers (gaps) for each shop';

-- ============================================================
-- View: order_sequence_missing_data
-- ============================================================
-- Identifies orders that exist in sequence but missing from orders/skus
-- ============================================================
CREATE OR REPLACE VIEW order_sequence_missing_data AS
SELECT
    osv.shop,
    osv.shopify_order_number,
    osv.order_id,
    osv.exists_in_orders,
    osv.exists_in_skus,
    osv.first_seen_at,
    osv.last_verified_at,
    CASE
        WHEN NOT osv.exists_in_orders AND NOT osv.exists_in_skus THEN 'BOTH'
        WHEN NOT osv.exists_in_orders THEN 'ORDERS'
        WHEN NOT osv.exists_in_skus THEN 'SKUS'
    END as missing_from
FROM order_sequence_validation osv
WHERE osv.exists_in_orders = FALSE
   OR osv.exists_in_skus = FALSE
ORDER BY osv.shop, osv.shopify_order_number;

COMMENT ON VIEW order_sequence_missing_data IS
    'Shows orders in sequence that are missing from orders or skus tables';

-- ============================================================
-- Function: refresh_order_sequence_validation
-- ============================================================
-- Updates validation flags by checking orders and skus tables
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_order_sequence_validation()
RETURNS TABLE(
    shop TEXT,
    total_checked BIGINT,
    found_in_orders BIGINT,
    found_in_skus BIGINT,
    missing_orders BIGINT,
    missing_skus BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update exists_in_orders flag
    UPDATE order_sequence_validation osv
    SET
        exists_in_orders = EXISTS (
            SELECT 1 FROM orders o
            WHERE o.shop = osv.shop
            AND o.order_id = osv.order_id
        ),
        exists_in_skus = EXISTS (
            SELECT 1 FROM skus s
            WHERE s.shop = osv.shop
            AND s.order_id = osv.order_id
        ),
        last_verified_at = NOW();

    -- Return summary statistics
    RETURN QUERY
    SELECT
        osv.shop,
        COUNT(*) as total_checked,
        COUNT(*) FILTER (WHERE osv.exists_in_orders) as found_in_orders,
        COUNT(*) FILTER (WHERE osv.exists_in_skus) as found_in_skus,
        COUNT(*) FILTER (WHERE NOT osv.exists_in_orders) as missing_orders,
        COUNT(*) FILTER (WHERE NOT osv.exists_in_skus) as missing_skus
    FROM order_sequence_validation osv
    GROUP BY osv.shop
    ORDER BY osv.shop;
END;
$$;

COMMENT ON FUNCTION refresh_order_sequence_validation IS
    'Updates validation flags and returns summary of data quality per shop';

-- ============================================================
-- Function: populate_order_sequence_from_orders
-- ============================================================
-- Populates sequence table from existing orders table
-- ============================================================
CREATE OR REPLACE FUNCTION populate_order_sequence_from_orders()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    inserted_count BIGINT;
BEGIN
    -- Insert from orders table with conflict handling
    INSERT INTO order_sequence_validation (
        shop,
        shopify_order_number,
        order_id,
        exists_in_orders,
        exists_in_skus
    )
    SELECT DISTINCT
        o.shop,
        o.order_number as shopify_order_number,
        o.order_id,
        TRUE as exists_in_orders,
        EXISTS (
            SELECT 1 FROM skus s
            WHERE s.shop = o.shop
            AND s.order_id = o.order_id
        ) as exists_in_skus
    FROM orders o
    WHERE o.order_number IS NOT NULL
    ON CONFLICT (shop, shopify_order_number)
    DO UPDATE SET
        order_id = EXCLUDED.order_id,
        exists_in_orders = TRUE,
        last_verified_at = NOW();

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$;

COMMENT ON FUNCTION populate_order_sequence_from_orders IS
    'Populates order_sequence_validation from orders table';

-- ============================================================
-- Grant Permissions
-- ============================================================
-- Grant read access to authenticated users
GRANT SELECT ON order_sequence_validation TO authenticated;
GRANT SELECT ON order_sequence_gaps TO authenticated;
GRANT SELECT ON order_sequence_missing_data TO authenticated;

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION refresh_order_sequence_validation TO authenticated;
GRANT EXECUTE ON FUNCTION populate_order_sequence_from_orders TO authenticated;

-- ============================================================
-- Initial Population (commented out - run manually)
-- ============================================================
-- Uncomment and run after creating the table:
-- SELECT populate_order_sequence_from_orders();
-- SELECT * FROM refresh_order_sequence_validation();
