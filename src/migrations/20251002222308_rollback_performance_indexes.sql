-- Rollback Migration: Remove Performance Indexes
-- Created: 2025-10-02
-- Purpose: Rollback script for 20251002222308_add_performance_indexes.sql
--
-- Use this script if:
-- - Index creation causes performance degradation (rare but possible)
-- - Need to free up disk space urgently
-- - Indexes are not being used by query planner (check pg_stat_user_indexes)
--
-- Warning: This will remove indexes that improve query performance.
-- Only run this if you have confirmed the indexes are causing issues.

-- ============================================================================
-- REMOVE INDEXES (in reverse order of creation)
-- ============================================================================

-- Drop composite optimization indexes first
DROP INDEX CONCURRENTLY IF EXISTS idx_skus_shop_refund;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shop_refund;

-- Drop fulfillment order mapping index
DROP INDEX CONCURRENTLY IF EXISTS idx_fulfillments_order_id;

-- Drop critical refund date indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_skus_refund_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_refund_date;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify all indexes were dropped successfully
-- This should return 0 rows if rollback was successful
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname IN (
    'idx_orders_refund_date',
    'idx_skus_refund_date',
    'idx_fulfillments_order_id',
    'idx_orders_shop_refund',
    'idx_skus_shop_refund'
)
ORDER BY tablename, indexname;

-- If the above returns 0 rows, rollback was successful
-- Output: "0 rows" = SUCCESS
