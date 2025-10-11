#!/bin/bash
# Simple monitoring script for sync progress

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

clear
echo "📊 LIVE SYNC MONITOR"
echo "===================="
echo ""

while true; do
  # Get job counts
  response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY")

  pending=$(echo "$response" | jq '[.[] | select(.status == "pending")] | length' 2>/dev/null || echo "0")
  running=$(echo "$response" | jq '[.[] | select(.status == "running")] | length' 2>/dev/null || echo "0")
  completed=$(echo "$response" | jq '[.[] | select(.status == "completed")] | length' 2>/dev/null || echo "0")
  failed=$(echo "$response" | jq '[.[] | select(.status == "failed")] | length' 2>/dev/null || echo "0")

  # Clear screen and show status
  printf "\033[2K\r"  # Clear line
  echo -ne "⏳ Pending: $pending | 🔄 Running: $running | ✅ Completed: $completed | ❌ Failed: $failed"

  # If all done, break
  if [ "$pending" = "0" ] && [ "$running" = "0" ]; then
    echo ""
    echo ""
    echo "🎉 ALL JOBS COMPLETED!"
    break
  fi

  sleep 5
done

echo ""
echo "Final coverage check:"
echo "SELECT shop, COUNT(DISTINCT DATE(created_at_original)) || '/375' as days FROM skus WHERE created_at_original >= '2024-09-30' AND created_at_original < '2025-10-10' GROUP BY shop;"