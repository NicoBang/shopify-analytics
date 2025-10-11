#!/bin/bash

# Quick sync status check for our specific date range
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

clear
echo "📊 SYNC STATUS - Period: 2024-09-30 to 2025-10-09"
echo "=================================================="
echo ""

# Get counts for our specific date range only
echo "🔄 Fetching status for 1875 expected jobs..."
echo ""

# Use proper API calls with our date filter
response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Range: 0-2999")

completed=$(echo "$response" | jq '[.[] | select(.status == "completed")] | length')
running=$(echo "$response" | jq '[.[] | select(.status == "running")] | length')
pending=$(echo "$response" | jq '[.[] | select(.status == "pending")] | length')
failed=$(echo "$response" | jq '[.[] | select(.status == "failed")] | length')

total=$((completed + running + pending + failed))
progress=$((completed * 100 / 1875))

# Display status
echo "✅ Completed: $completed / 1875 ($progress%)"
echo "🔄 Running:   $running"
echo "⏳ Pending:   $pending"
if [ "$failed" -gt "0" ]; then
  echo "❌ Failed:    $failed"
fi
echo "------------------------"
echo "📦 Total:     $total jobs"
echo ""

# Progress bar
echo -n "Progress: ["
for i in $(seq 1 50); do
  if [ $i -le $((progress / 2)) ]; then
    echo -n "█"
  else
    echo -n "░"
  fi
done
echo "] $progress%"
echo ""

# Check if jobs are actually processing
if [ "$running" -gt "0" ]; then
  echo "✅ SYNC IS RUNNING - $running jobs being processed"
  echo ""
  echo "Currently syncing:"
  curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.running&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=shop,start_date" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "  • \(.shop | split(".")[0] | split("-")[1] | ascii_upcase): \(.start_date)"'
elif [ "$pending" -gt "0" ]; then
  echo "⏸️  Jobs pending but not running. Starting orchestrator..."
  curl -s -X POST "$SUPABASE_URL/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null 2>&1 &
  echo "✅ Orchestrator started!"
else
  echo "🎉 ALL JOBS COMPLETED!"
fi

echo ""
echo "⏱️  Estimated time remaining: $((pending / 20)) minutes"
echo ""

# Show per-shop status
echo "📊 Status per shop:"
curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=shop,status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Range: 0-2999" | jq 'group_by(.shop) | map({
    shop: (.[0].shop | split(".")[0] | split("-")[1] | ascii_upcase),
    completed: ([.[] | select(.status == "completed")] | length),
    pending: ([.[] | select(.status == "pending")] | length),
    total: length
  })' | jq -r '.[] | "  \(.shop): \(.completed)/\(.total) completed (\(.pending) pending)"'

echo ""
echo "💡 To monitor live: ./live-sync-monitor.sh"
echo "💡 To process pending: ./fix-and-continue-sync.sh"