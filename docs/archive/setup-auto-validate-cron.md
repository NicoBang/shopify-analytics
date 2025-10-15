# Setup Auto-Validate Cron Job

## Step 1: Deploy Edge Function ✅
```bash
npx supabase functions deploy auto-validate-failed-jobs --no-verify-jwt
```

## Step 2: Setup Cron Job

Go to Supabase Dashboard → SQL Editor and run:

```sql
-- Remove existing cron job if it exists
SELECT cron.unschedule('auto-validate-failed-jobs');

-- Schedule auto-validate to run daily at 2 AM
SELECT cron.schedule(
  'auto-validate-failed-jobs',
  '0 2 * * *',  -- 2 AM every day
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/auto-validate-failed-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify cron job was created
SELECT * FROM cron.job WHERE jobname = 'auto-validate-failed-jobs';
```

## Step 3: Test Manually (Optional)
```bash
./test-auto-validate.sh
```

## What It Does

🤖 **100% Automated System**

1. **Runs daily at 2 AM** automatically
2. **Validates all failed jobs** (orders, SKUs, refunds)
3. **Checks Shopify API** to verify if there was data on failed dates
4. **Marks empty days as completed** (not real failures)
5. **Preserves real failures** for manual attention

## Schedule

- **Frequency:** Daily
- **Time:** 2:00 AM (UTC)
- **Cron:** `0 2 * * *`

## Monitoring

Check logs in Supabase Dashboard:
- Functions → auto-validate-failed-jobs → Logs

## Manual Trigger

To run validation immediately:
```bash
./test-auto-validate.sh
```
