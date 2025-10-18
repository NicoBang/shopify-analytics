# Setup Style Analytics Pre-aggregation

All bugs have been fixed and deployed. Now ready to implement pre-aggregation for Color/SKU/Number Analytics.

## Step 1: Run Migration in Supabase Dashboard

1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the entire contents of `supabase/migrations/20251015_create_style_metrics.sql`
3. Click "Run" to create the 3 tables:
   - `daily_color_metrics`
   - `daily_sku_metrics`
   - `daily_number_metrics`

## Step 2: Test Single Day Aggregation

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-style-metrics" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-01-15"}'
```

## Step 3: Backfill Historical Data

```bash
./backfill-style-metrics.sh
```

This will backfill 365 days of historical data (2024-09-01 to 2025-10-15).

## Expected Results

After backfill completes:
- Color Analytics: <2s response (currently 5-10s)
- SKU Analytics: <2s response (currently 5-10s)
- Number Analytics: <2s response (currently 5-10s)

## Status

- ✅ Migration file ready: `supabase/migrations/20251015_create_style_metrics.sql`
- ✅ Aggregation function deployed: `aggregate-style-metrics` (with timezone + revenue fixes)
- ✅ Backfill script ready: `./backfill-style-metrics.sh`
- ⏳ Waiting for: Migration to be run in Supabase Dashboard
