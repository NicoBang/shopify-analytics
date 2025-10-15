-- ============================================
-- DAILY CRON JOBS SETUP
-- ============================================
-- Run this SQL in Supabase SQL Editor to set up automated daily syncs

-- Step 1: Clean up old/legacy jobs (ignore errors if already deleted)
-- ============================================
DO $$
BEGIN
  -- Delete deactivated legacy jobs if they exist
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobid IN (3, 6);

  -- Delete old watchdog if it exists (job 1)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 1) THEN
    PERFORM cron.unschedule(1);
  END IF;

  -- Delete old continue-orchestrator if it exists (job 5)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 5) THEN
    PERFORM cron.unschedule(5);
  END IF;
END $$;

-- Step 2: Create NEW watchdog job (runs every minute)
-- ============================================

SELECT cron.schedule(
  'watchdog-cleanup',
  '* * * * *',  -- Every minute (not every 2 minutes)
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Step 3: Create NEW continue-orchestrator job (runs every 5 minutes)
-- ============================================
SELECT cron.schedule(
  'auto-continue-orchestrator',
  '*/5 * * * *',  -- Every 5 minutes (not every 4 minutes)
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Step 4: Add MISSING daily-sync-orchestrator (creates jobs for yesterday's data)
-- ============================================
SELECT cron.schedule(
  'daily-sync-orchestrator',
  '0 2 * * *',  -- At 02:00 every day
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'startDate', (CURRENT_DATE - INTERVAL '1 day')::text,
      'endDate', (CURRENT_DATE - INTERVAL '1 day')::text
    )::jsonb
  );
  $$
);

-- Step 5: Add Fulfillments sync (daily at 08:00)
-- ============================================
SELECT cron.schedule(
  'daily-fulfillments-sync',
  '0 8 * * *',  -- At 08:00 every day (after orders/SKUs are synced)
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'all',
      'type', 'fulfillments',
      'startDate', (CURRENT_DATE - INTERVAL '1 day')::text,
      'endDate', (CURRENT_DATE - INTERVAL '1 day')::text
    )::jsonb
  );
  $$
);

-- Step 6: Add Inventory sync (daily at 09:00)
-- ============================================
SELECT cron.schedule(
  'daily-inventory-sync',
  '0 9 * * *',  -- At 09:00 every day (after fulfillments)
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'all',
      'type', 'inventory'
    )::jsonb
  );
  $$
);

-- Step 7: Verify all jobs are active
-- ============================================
SELECT
  jobid,
  jobname,
  schedule,
  active,
  LEFT(command, 100) as command_preview
FROM cron.job
WHERE active = true
ORDER BY jobname;

-- Expected output (6 jobs):
-- - auto-continue-orchestrator (*/5 * * * *)
-- - auto-validate-failed-jobs (0 2 * * *)
-- - daily-fulfillments-sync (0 8 * * *)
-- - daily-inventory-sync (0 9 * * *)
-- - daily-sync-orchestrator (0 2 * * *)
-- - watchdog-cleanup (* * * * *)
