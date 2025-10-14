#!/bin/bash

# Create all orders jobs for historical sync
# Usage: ./create-all-orders-jobs.sh

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🚀 Creating all orders jobs..."

while true; do
  result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/create-missing-jobs" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"startDate": "2024-09-30", "endDate": "2025-10-12", "objectType": "orders"}')

  echo "$result"

  if echo "$result" | grep -q '"complete":true'; then
    echo "✅ All orders jobs created!"
    break
  fi

  sleep 2
done

echo ""
echo "📊 Checking status..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.orders&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  | jq '[group_by(.status) | .[] | {status: .[0].status, count: length}]'

echo ""
echo "✅ Done! Cron will process jobs automatically every 5 minutes."
echo "   Monitor: ./check-sync-status.sh 2024-09-30 2025-10-12"
