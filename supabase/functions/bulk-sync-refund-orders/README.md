# Shopify Bulk Operations Edge Sync

Supabase Edge Function for syncing large Shopify datasets without timeout limitations.

## Purpose

Solves the Vercel 60-second timeout problem for large data syncs:
- ✅ October 2024 full month (3,668+ orders, 20,000+ SKUs)
- ✅ Black Friday / Cyber Monday periods
- ✅ Historical data backfills
- ✅ Batch resync operations

## Architecture

```
Client Request
  ↓
Edge Function starts Shopify Bulk Operation
  ↓
Poll every 10s until COMPLETED (max 1 hour)
  ↓
Download JSONL file from Shopify
  ↓
Stream parse & batch upsert (500 records/batch)
  ↓
Update bulk_sync_jobs table with progress
  ↓
Return final status
```

## Features

- **No timeout limits** - runs asynchronously
- **Real-time progress tracking** via `bulk_sync_jobs` table
- **Batch processing** - 500 records at a time
- **Currency conversion** - DKK, EUR, CHF
- **Comprehensive error handling** - automatic rollback on failure
- **Multi-shop support** - all 5 Pompdelux stores

## Setup

### 1. Install Supabase CLI

```bash
brew install supabase/tap/supabase
```

### 2. Link Project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 3. Set Environment Variables

In Supabase Dashboard → Project Settings → Edge Functions → Secrets:

```
SUPABASE_URL=https://ihawjrtfwysyokfotewn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-key>
SHOPIFY_TOKEN_DA=<danish-shop-token>
SHOPIFY_TOKEN_DE=<german-shop-token>
SHOPIFY_TOKEN_NL=<dutch-shop-token>
SHOPIFY_TOKEN_INT=<international-shop-token>
SHOPIFY_TOKEN_CHF=<swiss-shop-token>
```

### 4. Deploy

```bash
supabase functions deploy bulk-sync-orders
```

## Usage

### Sync Orders & SKUs

```bash
# Sync October 2024 for Danish shop
supabase functions invoke bulk-sync-orders \
  --data '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2024-10-01",
    "endDate": "2024-10-31",
    "objectType": "both"
  }'
```

### Check Status

```sql
-- In Supabase SQL Editor
SELECT * FROM bulk_sync_jobs
ORDER BY created_at DESC
LIMIT 5;
```

### Monitor Progress

```sql
-- Watch real-time updates
SELECT
  id,
  shop,
  status,
  records_processed,
  orders_synced,
  skus_synced,
  created_at,
  completed_at
FROM bulk_sync_jobs
WHERE status IN ('running', 'polling', 'downloading', 'processing')
ORDER BY created_at DESC;
```

## API Response

### Success

```json
{
  "success": true,
  "jobId": "uuid",
  "status": "completed",
  "ordersProcessed": 3668,
  "skusProcessed": 20142,
  "recordsProcessed": 23810,
  "durationSec": 120
}
```

### Error

```json
{
  "error": "Bulk operation failed: TIMEOUT"
}
```

## Performance

| Dataset Size | Expected Duration |
|-------------|-------------------|
| 100-500 orders | 30-60 seconds |
| 500-2,000 orders | 1-3 minutes |
| 2,000-5,000 orders | 3-10 minutes |
| Black Friday week | 5-15 minutes |

## Troubleshooting

### Job stuck in "polling" status

```sql
-- Check Shopify bulk operation status manually
SELECT * FROM bulk_sync_jobs
WHERE status = 'polling'
ORDER BY created_at DESC;

-- Then check Shopify Admin → Settings → Notifications → Bulk operations
```

### Job failed with error

```sql
-- View error details
SELECT error_message, * FROM bulk_sync_jobs
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### Re-run failed job

```bash
# Get date range from failed job, then invoke again
supabase functions invoke bulk-sync-orders \
  --data '{"shop":"pompdelux-da.myshopify.com","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","objectType":"both"}'
```

## Rollback

```bash
# Remove Edge Function
rm -rf supabase/functions/bulk-sync-orders

# Drop database table
psql -U postgres -d postgres <<EOF
DROP TABLE IF EXISTS bulk_sync_jobs CASCADE;
EOF

# Or via Supabase SQL Editor
# DROP TABLE IF EXISTS bulk_sync_jobs CASCADE;
```

## Development

### Test Locally

```bash
# Start Supabase locally
supabase start

# Serve function locally
supabase functions serve bulk-sync-orders --env-file .env.local

# Invoke locally
curl -i --location --request POST 'http://localhost:54321/functions/v1/bulk-sync-orders' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2024-10-01",
    "endDate": "2024-10-07"
  }'
```

### Debug Logs

```bash
# View Edge Function logs
supabase functions logs bulk-sync-orders --follow
```

## Integration with Existing System

### Replace Vercel timeout-prone syncs

Instead of:
```bash
# This times out for large periods ❌
curl "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=X&type=skus&startDate=2024-10-01&endDate=2024-10-31"
```

Use:
```bash
# This never times out ✅
supabase functions invoke bulk-sync-orders \
  --data '{"shop":"X","startDate":"2024-10-01","endDate":"2024-10-31","objectType":"both"}'
```

### Update cron jobs

For large monthly syncs, switch from Vercel API to Edge Function:

```javascript
// Old (Vercel) - times out
const response = await fetch('https://shopify-analytics-nu.vercel.app/api/sync-shop?...');

// New (Supabase Edge) - never times out
const response = await fetch('https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <anon-key>' },
  body: JSON.stringify({ shop, startDate, endDate, objectType: 'both' })
});
```

## Next Steps

1. ✅ Set up Supabase CLI
2. ✅ Link project
3. ✅ Deploy Edge Function
4. ⏳ Add Shopify tokens to secrets
5. ⏳ Test with October 2024
6. ⏳ Update cron jobs for large syncs
7. ⏳ Monitor `bulk_sync_jobs` table
