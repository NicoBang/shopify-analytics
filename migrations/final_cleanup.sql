-- FINAL CLEANUP: Fix dates and remove duplicates
-- Run this in Supabase SQL Editor

-- Step 1: Remove existing constraint if it exists
ALTER TABLE fulfillments
DROP CONSTRAINT IF EXISTS fulfillments_order_date_unique;

-- Step 2: Show current problematic data
SELECT
  'BEFORE NORMALIZATION' as status,
  order_id,
  date,
  COUNT(*) as count
FROM fulfillments
WHERE order_id = '6155683758419'
GROUP BY order_id, date
ORDER BY date;

-- Step 3: Normalize all dates to midnight (remove time component)
UPDATE fulfillments
SET date = DATE(date)::timestamp with time zone;

-- Step 4: Show statistics AFTER normalization but BEFORE cleanup
SELECT
  'AFTER DATE NORMALIZATION' as status,
  COUNT(*) as total_records,
  COUNT(DISTINCT (order_id, date)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT (order_id, date)) as duplicates_to_remove
FROM fulfillments;

-- Step 5: Create aggregation table
CREATE TEMP TABLE fulfillments_aggregated AS
SELECT
  order_id,
  date,
  SUM(item_count) as total_item_count,
  (ARRAY_AGG(country ORDER BY created_at))[1] as country,
  (ARRAY_AGG(carrier ORDER BY created_at))[1] as carrier,
  (ARRAY_AGG(id ORDER BY created_at))[1] as keep_id
FROM fulfillments
GROUP BY order_id, date
HAVING COUNT(*) > 1;

-- Step 6: Update records with aggregated item_count
UPDATE fulfillments f
SET
  item_count = a.total_item_count
FROM fulfillments_aggregated a
WHERE f.id = a.keep_id;

-- Step 7: Delete duplicates (keep oldest)
WITH duplicates_to_delete AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY order_id, date
        ORDER BY created_at ASC
      ) as row_num
    FROM fulfillments
  ) ranked
  WHERE row_num > 1
)
DELETE FROM fulfillments
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Step 8: Verify cleanup
SELECT
  'AFTER CLEANUP' as status,
  COUNT(*) as total_records,
  COUNT(DISTINCT (order_id, date)) as unique_combinations,
  COUNT(*) - COUNT(DISTINCT (order_id, date)) as remaining_duplicates
FROM fulfillments;

-- Step 9: Show fixed sample data
SELECT
  order_id,
  date,
  item_count,
  COUNT(*) as count
FROM fulfillments
WHERE order_id = '6155683758419'
GROUP BY order_id, date, item_count
ORDER BY date;

-- Step 10: NOW add unique constraint (after all duplicates removed)
ALTER TABLE fulfillments
ADD CONSTRAINT fulfillments_order_date_unique
UNIQUE (order_id, date);

-- Step 11: Add performance indexes
CREATE INDEX IF NOT EXISTS idx_fulfillments_date ON fulfillments(date);
CREATE INDEX IF NOT EXISTS idx_fulfillments_country ON fulfillments(country);
CREATE INDEX IF NOT EXISTS idx_fulfillments_carrier ON fulfillments(carrier);

-- Final confirmation
SELECT 'CLEANUP COMPLETE ✅' as status,
       'All duplicates removed and constraint added' as message;