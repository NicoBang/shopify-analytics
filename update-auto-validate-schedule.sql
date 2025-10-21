-- Update auto-validate-failed-jobs to run every 5 minutes instead of daily at 2 AM

-- Remove existing cron job
SELECT cron.unschedule('auto-validate-failed-jobs');

-- Schedule auto-validate to run every 5 minutes
SELECT cron.schedule(
  'auto-validate-failed-jobs',
  '*/5 * * * *',  -- Every 5 minutes
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

-- Verify cron job was updated
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'auto-validate-failed-jobs';
