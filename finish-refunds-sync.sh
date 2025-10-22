#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🚀 Finishing refunds sync (85 remaining jobs)..."
echo ""

# Trigger continue-orchestrator multiple times in background
echo "📋 Triggering continue-orchestrator (5 parallel calls)..."
for i in {1..5}; do
  curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{}' \
    > /dev/null 2>&1 &
done

echo "   ✅ Triggers sent"
echo ""

# Monitor progress
echo "⏳ Monitoring progress (updates every 30 seconds)..."
echo ""

start_time=$(date +%s)
total=407  # 322 completed + 85 pending

for iteration in {1..20}; do
  sleep 30

  # Get status counts
  status_json=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY")

  completed=$(echo "$status_json" | jq -r '[.[] | select(.status == "completed")] | length')
  pending=$(echo "$status_json" | jq -r '[.[] | select(.status == "pending")] | length')
  running=$(echo "$status_json" | jq -r '[.[] | select(.status == "running")] | length')
  failed=$(echo "$status_json" | jq -r '[.[] | select(.status == "failed")] | length')

  # Calculate progress
  pct=$((completed * 100 / total))

  # Calculate elapsed time
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))
  elapsed_min=$((elapsed / 60))

  # Display progress
  echo "$(date '+%H:%M:%S') │ Completed: $completed/$total ($pct%) │ Pending: $pending │ Running: $running │ Failed: $failed │ Elapsed: ${elapsed_min}m"

  # Check if done
  if [ "$pending" = "0" ] && [ "$running" = "0" ]; then
    echo ""
    echo "✅ All jobs processed!"
    break
  fi

  # Trigger again every 2 minutes to keep processing
  if [ $((iteration % 4)) -eq 0 ]; then
    echo "   🔄 Re-triggering continue-orchestrator..."
    curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d '{}' \
      > /dev/null 2>&1 &
  fi
done

echo ""
echo "📊 Final Status:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq -r 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "🎉 Refunds sync complete!"
