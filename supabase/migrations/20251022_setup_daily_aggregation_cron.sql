-- Setup daily aggregation cron jobs for all metrics tables
-- Runs at 04:00 UTC (06:00 Danish time) every day
-- 2 hours after sync jobs (which run at 02:00 UTC)

-- Remove existing cron jobs if they exist
SELECT cron.unschedule('daily-aggregate-shop-metrics') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-aggregate-shop-metrics'
);

SELECT cron.unschedule('daily-aggregate-color-metrics') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-aggregate-color-metrics'
);

SELECT cron.unschedule('daily-aggregate-sku-metrics') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-aggregate-sku-metrics'
);

-- Schedule daily_shop_metrics aggregation at 04:00 UTC
SELECT cron.schedule(
  'daily-aggregate-shop-metrics',
  '0 4 * * *',  -- 04:00 UTC every day
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5 minute timeout
  );
  $$
);

-- Schedule daily_color_metrics aggregation at 04:10 UTC (10 min after shop metrics)
SELECT cron.schedule(
  'daily-aggregate-color-metrics',
  '10 4 * * *',  -- 04:10 UTC every day
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-color-metrics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5 minute timeout
  );
  $$
);

-- Schedule daily_sku_metrics aggregation at 04:20 UTC (20 min after shop metrics)
SELECT cron.schedule(
  'daily-aggregate-sku-metrics',
  '20 4 * * *',  -- 04:20 UTC every day
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-metrics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5 minute timeout
  );
  $$
);

-- Verify cron jobs were created
SELECT
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE '%aggregate%'
ORDER BY jobname;
