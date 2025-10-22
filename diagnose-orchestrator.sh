#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔍 Diagnosing continue-orchestrator..."
echo ""

echo "1️⃣ Checking cron job status..."
PGPASSWORD="$KEY" psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -c "
SELECT
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE '%continue%'
ORDER BY jobid;
"

echo ""
echo "2️⃣ Checking recent cron executions..."
PGPASSWORD="$KEY" psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -c "
SELECT
  jobid,
  runid,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE '%continue%')
ORDER BY runid DESC
LIMIT 10;
"

echo ""
echo "3️⃣ Checking pending refund jobs..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&status=eq.pending&select=shop,start_date,created_at&order=created_at.asc&limit=5" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "4️⃣ Checking running refund jobs..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&status=eq.running&select=shop,start_date,started_at" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "5️⃣ Manually triggering continue-orchestrator..."
response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

echo "$response" | jq '.'

echo ""
echo "6️⃣ Checking job counts after manual trigger..."
sleep 5
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'
