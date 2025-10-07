#!/bin/bash

# Usage: ./sync-date-range-refunds.sh 2025-10-01 2025-10-07
# Syncs orders with refunds in the specified date range (based on updated_at)

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE=${1:-"2025-10-01"}
END_DATE=${2:-"2025-10-07"}

echo "🔄 Starting updated orders sync for all shops from $START_DATE to $END_DATE"
echo "   This syncs orders that were UPDATED in this period (using updated_at)"
echo "   Note: This catches orders created earlier but modified in this period"
echo "         (refunds, cancellations, edits, etc.)"
echo ""

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

SUCCESS_COUNT=0
FAILED_COUNT=0

for shop in "${SHOPS[@]}"; do
  shop_short=$(echo $shop | cut -d. -f1 | sed 's/pompdelux-//')
  
  echo "📦 Syncing $shop_short..."
  
  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refund-orders" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"shop\": \"$shop\",
      \"startDate\": \"$START_DATE\",
      \"endDate\": \"$END_DATE\"
    }")
  
  success=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null)
  
  if [ "$success" = "True" ]; then
    orders=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('ordersProcessed', 0))")
    echo "   ✅ $shop_short: $orders orders synced"
    ((SUCCESS_COUNT++))
  else
    error=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('error', 'Unknown error'))" 2>/dev/null)
    echo "   ❌ $shop_short: Failed - $error"
    ((FAILED_COUNT++))
  fi
  
  sleep 2
done

echo ""
echo "📊 Summary:"
echo "   ✅ Successful: $SUCCESS_COUNT"
echo "   ❌ Failed:     $FAILED_COUNT"
echo ""
echo "💡 Check results with: ./check-sync-status.sh $START_DATE $END_DATE"
