-- Migration: Backfill created_at_original from created_at for NULL values
-- Purpose: Ensure all SKUs have created_at_original populated with Shopify order date
-- Context: Batch-synced SKUs (May-September) have created_at but created_at_original=NULL
-- This is a one-time backfill - future inserts via bulk-sync-skus will populate both fields

-- Step 1: Check current state BEFORE migration
DO $$
DECLARE
  total_count INTEGER;
  null_count INTEGER;
  populated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM skus;
  SELECT COUNT(*) INTO null_count FROM skus WHERE created_at_original IS NULL;
  populated_count := total_count - null_count;

  RAISE NOTICE '📊 Current state:';
  RAISE NOTICE '   Total SKUs: %', total_count;
  RAISE NOTICE '   NULL created_at_original: %', null_count;
  RAISE NOTICE '   Already populated: %', populated_count;
END $$;

-- Step 2: Backfill created_at_original from created_at where NULL
-- Convert DATE to TIMESTAMPTZ (assume midnight UTC on that date)
UPDATE skus
SET created_at_original = (created_at::text || 'T00:00:00Z')::timestamptz
WHERE created_at_original IS NULL
  AND created_at IS NOT NULL;

-- Step 3: Verify results AFTER migration
DO $$
DECLARE
  total_count INTEGER;
  null_count INTEGER;
  populated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM skus;
  SELECT COUNT(*) INTO null_count FROM skus WHERE created_at_original IS NULL;
  populated_count := total_count - null_count;

  RAISE NOTICE '✅ Results after migration:';
  RAISE NOTICE '   Total SKUs: %', total_count;
  RAISE NOTICE '   Remaining NULL: %', null_count;
  RAISE NOTICE '   Now populated: %', populated_count;
END $$;
