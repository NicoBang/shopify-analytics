# Performance Benchmark Instructions

## Purpose
Measure the performance impact of adding indexes for `refund_date` and `order_id` queries.

## Prerequisites
- Access to Supabase SQL Editor
- Production database with representative data volume

## Step 1: Collect BEFORE Baseline

### 1.1 Run Baseline Metrics
Copy and paste into Supabase SQL Editor:

```sql
-- File: tests/perf/explain_analyze_refund_queries.sql (lines 126-148)
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
```

**Save output as**: `baseline_metrics.txt`

### 1.2 Run EXPLAIN ANALYZE - Query 1 (Orders Refund Date)
```sql
-- File: tests/perf/explain_analyze_refund_queries.sql (lines 23-36)
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
```

**Look for**:
- Execution Time: _____ ms
- Scan Type: "Seq Scan" or "Index Scan"
- Rows Scanned: _____

**Save output as**: `before_query1_orders_refund.txt`

### 1.3 Run EXPLAIN ANALYZE - Query 2 (SKUs Refund Date)
```sql
-- File: tests/perf/explain_analyze_refund_queries.sql (lines 45-63)
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
```

**Save output as**: `before_query2_skus_refund.txt`

### 1.4 Run EXPLAIN ANALYZE - Query 3 (Fulfillments Join)
```sql
-- File: tests/perf/explain_analyze_refund_queries.sql (lines 72-87)
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
```

**Save output as**: `before_query3_fulfillments_join.txt`

## Step 2: Apply Migration

### 2.1 Run Migration Script
Copy and paste into Supabase SQL Editor:

```sql
-- File: src/migrations/20251002222308_add_performance_indexes.sql
-- (Full file content - use CONCURRENTLY to avoid table locks)
```

**Expected duration**: 1-5 minutes (depending on table size)

**Verify indexes were created**:
```sql
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
```

**Expected**: 5 rows (all indexes present)

## Step 3: Collect AFTER Metrics

### 3.1 Re-run Query 1
Same query as Step 1.2

**Save output as**: `after_query1_orders_refund.txt`

**Compare**:
- Execution Time: Should be 10-50x faster
- Scan Type: Should be "Index Scan using idx_orders_refund_date"

### 3.2 Re-run Query 2
Same query as Step 1.3

**Save output as**: `after_query2_skus_refund.txt`

**Compare**:
- Execution Time: Should be 10-50x faster
- Scan Type: Should be "Index Scan using idx_skus_refund_date"

### 3.3 Re-run Query 3
Same query as Step 1.4

**Save output as**: `after_query3_fulfillments_join.txt`

**Compare**:
- Join Type: Should use "Nested Loop" with "Index Scan using idx_fulfillments_order_id"

## Step 4: Document Results

Create summary in `benchmark_results.md`:

```markdown
# Index Performance Benchmark Results

## Baseline Metrics
- Orders: ___ rows, ___% with refund_date
- SKUs: ___ rows, ___% with refund_date
- Fulfillments: ___ rows

## Query 1: Orders Refund Date Filtering
- BEFORE: ___ ms (Seq Scan)
- AFTER: ___ ms (Index Scan)
- **Improvement**: __x faster

## Query 2: SKUs Refund Date Filtering
- BEFORE: ___ ms (Seq Scan)
- AFTER: ___ ms (Index Scan)
- **Improvement**: __x faster

## Query 3: Fulfillments Join
- BEFORE: ___ ms (Hash Join)
- AFTER: ___ ms (Nested Loop + Index Scan)
- **Improvement**: __x faster

## Conclusion
[Summary of performance gains and production readiness]
```

## Rollback (if needed)

If performance degrades or issues occur:

```sql
-- File: src/migrations/20251002222308_rollback_performance_indexes.sql
-- (Full file content)
```

## Notes

- Use `CONCURRENTLY` keyword to avoid table locks during index creation
- Indexes are created with `IF NOT EXISTS` for idempotency
- Partial indexes (WHERE refund_date IS NOT NULL) reduce index size by ~70%
- Monitor disk space during index creation (indexes can take 10-30% of table size)
