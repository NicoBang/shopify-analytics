-- Performance Benchmark: Refund Date Query Analysis
-- Created: 2025-10-02
-- Purpose: EXPLAIN ANALYZE queries to measure index impact
--
-- Usage:
-- 1. Run these queries BEFORE applying migration (save output as baseline)
-- 2. Apply migration: 20251002222308_add_performance_indexes.sql
-- 3. Run these queries AFTER migration (compare with baseline)
--
-- Expected Improvements:
-- - Query 1 (orders refund_date): Seq Scan → Index Scan (10-50x faster)
-- - Query 2 (skus refund_date): Seq Scan → Index Scan (10-50x faster)
-- - Query 3 (fulfillments order_id): Hash Join → Nested Loop (5-20x faster)
--
-- Metrics to compare:
-- - Planning Time: Should be similar (minimal change)
-- - Execution Time: Should decrease significantly
-- - Rows Scanned: Should decrease (partial index excludes NULL rows)
-- - Index Scan vs Seq Scan: Should change from Seq to Index

-- ============================================================================
-- QUERY 1: Orders Refund Date Filtering (analytics.js:68-71)
-- ============================================================================

-- Pattern: Get all orders with refund_date in September 2025
-- Expected BEFORE: Seq Scan on orders (Filter: refund_date IS NOT NULL AND refund_date >= ... AND refund_date <= ...)
-- Expected AFTER: Index Scan using idx_orders_refund_date on orders

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT
    shop,
    order_id,
    refund_date,
    refunded_amount,
    refunded_qty
FROM orders
WHERE refund_date IS NOT NULL
  AND refund_date >= '2025-09-01T00:00:00Z'
  AND refund_date <= '2025-09-30T23:59:59Z'
ORDER BY refund_date DESC;

-- ============================================================================
-- QUERY 2: SKUs Refund Date Filtering (metadata.js:553-556)
-- ============================================================================

-- Pattern: Get all SKUs with refund_date in September 2025
-- Expected BEFORE: Seq Scan on skus (Filter: refund_date IS NOT NULL AND refund_date >= ... AND refund_date <= ...)
-- Expected AFTER: Index Scan using idx_skus_refund_date on skus

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT
    sku,
    shop,
    order_id,
    quantity,
    refunded_qty,
    price_dkk,
    discount_per_unit_dkk,
    refund_date
FROM skus
WHERE refund_date IS NOT NULL
  AND refund_date >= '2025-09-01T00:00:00Z'
  AND refund_date <= '2025-09-30T23:59:59Z'
ORDER BY refund_date DESC;

-- ============================================================================
-- QUERY 3: Fulfillments Order ID Lookup (fulfillments.js:179-183)
-- ============================================================================

-- Pattern: Join fulfillments with orders to get carrier mapping
-- Expected BEFORE: Hash Join or Sequential Scan on fulfillments
-- Expected AFTER: Nested Loop with Index Scan on idx_fulfillments_order_id

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT
    f.order_id,
    f.carrier,
    o.country,
    o.refunded_qty,
    o.refund_date
FROM fulfillments f
INNER JOIN orders o ON f.order_id = o.order_id
WHERE o.refund_date IS NOT NULL
  AND o.refund_date >= '2025-09-01T00:00:00Z'
  AND o.refund_date <= '2025-09-30T23:59:59Z'
LIMIT 1000;

-- ============================================================================
-- QUERY 4: Composite Shop + Refund Date (future optimization)
-- ============================================================================

-- Pattern: Shop-specific refund analytics
-- Expected BEFORE: Seq Scan or Index Scan on idx_orders_shop_created (not optimal for refund_date)
-- Expected AFTER: Index Scan using idx_orders_shop_refund (optimized composite index)

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT
    shop,
    COUNT(*) as refund_count,
    SUM(refunded_amount) as total_refunded,
    SUM(refunded_qty) as total_items_refunded
FROM orders
WHERE shop = 'pompdelux-da.myshopify.com'
  AND refund_date IS NOT NULL
  AND refund_date >= '2025-09-01T00:00:00Z'
  AND refund_date <= '2025-09-30T23:59:59Z'
GROUP BY shop;

-- ============================================================================
-- QUERY 5: SKUs Composite Shop + Refund Date
-- ============================================================================

-- Pattern: Shop-specific SKU return analytics
-- Expected BEFORE: Seq Scan or Index Scan on idx_skus_shop_created (not optimal for refund_date)
-- Expected AFTER: Index Scan using idx_skus_shop_refund (optimized composite index)

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT
    shop,
    sku,
    SUM(quantity) as total_sold,
    SUM(refunded_qty) as total_refunded
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com'
  AND refund_date IS NOT NULL
  AND refund_date >= '2025-09-01T00:00:00Z'
  AND refund_date <= '2025-09-30T23:59:59Z'
GROUP BY shop, sku
LIMIT 100;

-- ============================================================================
-- BASELINE METRICS (to be collected BEFORE migration)
-- ============================================================================

-- Table row counts
SELECT
    'orders' as table_name,
    COUNT(*) as total_rows,
    COUNT(refund_date) as rows_with_refund_date,
    ROUND(100.0 * COUNT(refund_date) / NULLIF(COUNT(*), 0), 2) as refund_date_percentage
FROM orders
UNION ALL
SELECT
    'skus' as table_name,
    COUNT(*) as total_rows,
    COUNT(refund_date) as rows_with_refund_date,
    ROUND(100.0 * COUNT(refund_date) / NULLIF(COUNT(*), 0), 2) as refund_date_percentage
FROM skus
UNION ALL
SELECT
    'fulfillments' as table_name,
    COUNT(*) as total_rows,
    NULL as rows_with_refund_date,
    NULL as refund_date_percentage
FROM fulfillments;

-- Existing indexes (for comparison)
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'skus', 'fulfillments')
ORDER BY tablename, indexname;
