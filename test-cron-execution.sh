#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "=== Test 1: Check pending jobs count ==="
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.pending&select=count" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" \
  -H "Prefer: count=exact"

echo ""
echo ""
echo "=== Test 2: Manually trigger continue-orchestrator ==="
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

echo ""
echo ""
echo "=== Test 3: Wait 10 seconds and check pending jobs again ==="
sleep 10

curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.pending&select=count" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" \
  -H "Prefer: count=exact"

echo ""
echo ""
echo "=== Test 4: Check if pg_cron is creating jobs automatically ==="
echo "This should show recent cron job runs (if any):"
echo "Run this SQL manually:"
echo "SELECT jobid, runid, job_pid, status, return_message, start_time FROM cron.job_run_details WHERE jobid IN (88, 89) ORDER BY runid DESC LIMIT 10;"
