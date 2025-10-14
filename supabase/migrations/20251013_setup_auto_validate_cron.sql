-- Setup automatic failed job validation
-- Runs daily at 2 AM to validate failed jobs and mark empty days as completed

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
