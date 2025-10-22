#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🚀 Kickstarting continue-orchestrator processing..."
echo ""

for i in {1..7}; do
  echo "Iteration $i: Triggering continue-orchestrator..."

  # Trigger in background and don't wait for response
  curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{}' \
    --max-time 10 > /dev/null 2>&1 &

  # Wait 2 seconds before next trigger
  sleep 2

  # Check status
  status=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq -r 'group_by(.status) | map({status: .[0].status, count: length}) | .[]' | jq -s '.')

  completed=$(echo "$status" | jq -r '.[] | select(.status == "completed") | .count // 0')
  pending=$(echo "$status" | jq -r '.[] | select(.status == "pending") | .count // 0')
  running=$(echo "$status" | jq -r '.[] | select(.status == "running") | .count // 0')

  echo "  Status: Completed=$completed, Pending=$pending, Running=$running"
  echo ""
done

echo "✅ Kickstart complete! Monitoring for 2 minutes..."
echo ""

for i in {1..4}; do
  sleep 30

  status=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq -r 'group_by(.status) | map({status: .[0].status, count: length}) | .[]' | jq -s '.')

  completed=$(echo "$status" | jq -r '.[] | select(.status == "completed") | .count // 0')
  pending=$(echo "$status" | jq -r '.[] | select(.status == "pending") | .count // 0')
  running=$(echo "$status" | jq -r '.[] | select(.status == "running") | .count // 0')

  pct=$((completed * 100 / 428))

  echo "$(date '+%H:%M:%S') │ Progress: $completed/428 ($pct%) │ Pending: $pending │ Running: $running"
done

echo ""
echo "Jobs should now be processing. Resume monitoring script to track full completion."
