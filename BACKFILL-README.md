# Backfill Guide: created_at_original

## Problem
Batch-synced SKUs (May-September 2025) have:
- ✅ `created_at` = Shopify order date (correct)
- ❌ `created_at_original` = NULL (missing)

New SKUs (October onwards) have both fields populated correctly by bulk-sync-skus.

## Solution
Run the SQL migration to copy `created_at` → `created_at_original` for all NULL values.

## When to run
⚠️ **Wait until all bulk sync operations are complete** before running this migration.

## How to run

### Option 1: Supabase SQL Editor (Recommended)
1. Open Supabase Dashboard: https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/sql
2. Copy the contents of `migrations/backfill_created_at_original.sql`
3. Paste into the SQL Editor
4. Click "Run"
5. Check the output for verification stats

### Option 2: Command Line (if psql available)
```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  -h aws-0-eu-central-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.ihawjrtfwysyokfotewn \
  -d postgres \
  -f migrations/backfill_created_at_original.sql
```

## Expected Output
```
NOTICE:  📊 Current state:
NOTICE:     Total SKUs: ~50000
NOTICE:     NULL created_at_original: ~45000
NOTICE:     Already populated: ~5000
UPDATE 45000
NOTICE:  ✅ Results after migration:
NOTICE:     Total SKUs: ~50000
NOTICE:     Remaining NULL: 0
NOTICE:     Now populated: ~50000
```

## Verification
After running, verify all SKUs have `created_at_original`:

```sql
SELECT
  COUNT(*) as total_skus,
  COUNT(created_at_original) as with_original,
  COUNT(*) - COUNT(created_at_original) as remaining_null
FROM skus;
```

Expected: `remaining_null = 0`

## Post-Migration
Once verified:
1. Dashboard will correctly show historical data for all periods
2. All date-based queries will use `created_at_original` consistently
3. Future syncs will populate both fields automatically
