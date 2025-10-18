-- ============================================
-- DAILY CRON JOBS SETUP - FIXED VERSION
-- ============================================
-- Run this SQL in Supabase SQL Editor to set up automated daily syncs

-- Step 1: Clean up old/legacy jobs (ignore errors if already deleted)
-- ============================================
DO $$
BEGIN
  -- Delete all existing daily sync jobs to start fresh
  PERFORM cron.unschedule(j.jobid)
  FROM cron.job j
  WHERE j.jobname IN (
    'watchdog-cleanup',
    'auto-continue-orchestrator',
    'daily-sync-orchestrator',
    'daily-fulfillments-da',
    'daily-fulfillments-de',
    'daily-fulfillments-nl',
    'daily-fulfillments-int',
    'daily-fulfillments-chf',
    'daily-inventory-da',
    'daily-inventory-de',
    'daily-inventory-nl',
    'daily-inventory-int',
    'daily-inventory-chf'
  );
END $$;

-- Step 2: Create watchdog job (runs every minute)
-- ============================================
SELECT cron.schedule(
  'watchdog-cleanup',
  '* * * * *',
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

-- Step 3: Create continue-orchestrator job (runs every 5 minutes)
-- ============================================
SELECT cron.schedule(
  'auto-continue-orchestrator',
  '*/5 * * * *',
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

-- Step 4: Daily sync orchestrator - FIXED ISO 8601 timestamps + enforced order
-- ============================================
SELECT cron.schedule(
  'daily-sync-orchestrator',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD"T00:00:00Z"'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD"T23:59:59Z"'),
      'types', jsonb_build_array('orders', 'skus', 'refunds', 'shipping-discounts')
    )::jsonb
  );
  $$
);

-- Step 5: Fulfillments sync - SPLIT INTO 5 SEPARATE SHOPS
-- ============================================
-- DA shop
SELECT cron.schedule(
  'daily-fulfillments-da',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-da.myshopify.com',
      'type', 'fulfillments',
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')
    )::jsonb
  );
  $$
);

-- DE shop
SELECT cron.schedule(
  'daily-fulfillments-de',
  '5 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-de.myshopify.com',
      'type', 'fulfillments',
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')
    )::jsonb
  );
  $$
);

-- NL shop
SELECT cron.schedule(
  'daily-fulfillments-nl',
  '10 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-nl.myshopify.com',
      'type', 'fulfillments',
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')
    )::jsonb
  );
  $$
);

-- INT shop
SELECT cron.schedule(
  'daily-fulfillments-int',
  '15 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-int.myshopify.com',
      'type', 'fulfillments',
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')
    )::jsonb
  );
  $$
);

-- CHF shop
SELECT cron.schedule(
  'daily-fulfillments-chf',
  '20 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-chf.myshopify.com',
      'type', 'fulfillments',
      'startDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'),
      'endDate', to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')
    )::jsonb
  );
  $$
);

-- Step 6: Inventory sync - SPLIT INTO 5 SEPARATE SHOPS
-- ============================================
-- DA shop
SELECT cron.schedule(
  'daily-inventory-da',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-da.myshopify.com',
      'type', 'inventory'
    )::jsonb
  );
  $$
);

-- DE shop
SELECT cron.schedule(
  'daily-inventory-de',
  '5 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-de.myshopify.com',
      'type', 'inventory'
    )::jsonb
  );
  $$
);

-- NL shop
SELECT cron.schedule(
  'daily-inventory-nl',
  '10 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-nl.myshopify.com',
      'type', 'inventory'
    )::jsonb
  );
  $$
);

-- INT shop
SELECT cron.schedule(
  'daily-inventory-int',
  '15 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-int.myshopify.com',
      'type', 'inventory'
    )::jsonb
  );
  $$
);

-- CHF shop
SELECT cron.schedule(
  'daily-inventory-chf',
  '20 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://shopify-analytics-nu.vercel.app/api/sync-shop',
    headers := jsonb_build_object(
      'Authorization', 'Bearer bda5da3d49fe0e7391fded3895b5c6bc',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'shop', 'pompdelux-chf.myshopify.com',
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

-- Expected output (14 jobs):
-- - auto-continue-orchestrator (*/5 * * * *) - Processes pending jobs every 5 minutes
-- - auto-validate-failed-jobs (0 2 * * *) - Validates failed jobs daily at 02:00
-- - daily-fulfillments-chf (20 8 * * *) - CHF shop fulfillments at 08:20
-- - daily-fulfillments-da (0 8 * * *) - DA shop fulfillments at 08:00
-- - daily-fulfillments-de (5 8 * * *) - DE shop fulfillments at 08:05
-- - daily-fulfillments-int (15 8 * * *) - INT shop fulfillments at 08:15
-- - daily-fulfillments-nl (10 8 * * *) - NL shop fulfillments at 08:10
-- - daily-inventory-chf (20 9 * * *) - CHF shop inventory at 09:20
-- - daily-inventory-da (0 9 * * *) - DA shop inventory at 09:00
-- - daily-inventory-de (5 9 * * *) - DE shop inventory at 09:05
-- - daily-inventory-int (15 9 * * *) - INT shop inventory at 09:15
-- - daily-inventory-nl (10 9 * * *) - NL shop inventory at 09:10
-- - daily-sync-orchestrator (0 2 * * *) - Orders→SKUs→Refunds→Shipping daily at 02:00
-- - watchdog-cleanup (* * * * *) - Cleans stale jobs every minute

-- CRITICAL: daily-sync-orchestrator enforces dependency order:
--   1. orders (no dependencies)
--   2. skus (depends on orders)
--   3. refunds (depends on orders + skus)
--   4. shipping-discounts (depends on orders)
