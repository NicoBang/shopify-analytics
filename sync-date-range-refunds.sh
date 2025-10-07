#!/bin/bash

# Usage: ./sync-date-range-refunds.sh 2025-10-01 2025-10-07
# Syncs orders with refunds in the specified date range (based on updated_at)
# Processes ONE DAY AT A TIME to avoid Edge Function timeouts

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE=${1:-"2025-10-01"}
END_DATE=${2:-"2025-10-07"}

echo "🔄 Starting updated orders sync for all shops from $START_DATE to $END_DATE"
echo "   This syncs orders that were UPDATED in this period (using updated_at)"
echo "   Processing ONE DAY AT A TIME to avoid timeouts"
echo ""

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

# Generate array of dates (one day at a time)
current_date=$START_DATE
dates=()
while [[ "$current_date" < "$END_DATE" ]] || [[ "$current_date" == "$END_DATE" ]]; do
  dates+=("$current_date")
  current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d" 2>/dev/null || date -d "$current_date + 1 day" "+%Y-%m-%d")
done

echo "📅 Processing ${#dates[@]} days × ${#SHOPS[@]} shops = $((${#dates[@]} * ${#SHOPS[@]})) total jobs"
echo ""

SUCCESS_COUNT=0
FAILED_COUNT=0
TOTAL_ORDERS=0

# Process each date separately
for date in "${dates[@]}"; do
  echo "📆 Processing date: $date"

  for shop in "${SHOPS[@]}"; do
    shop_short=$(echo $shop | cut -d. -f1 | sed 's/pompdelux-//')

    echo "   📦 $shop_short ($date)..."

    response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refund-orders" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"shop\": \"$shop\",
        \"startDate\": \"$date\",
        \"endDate\": \"$date\"
      }")

    success=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null)

    if [ "$success" = "True" ]; then
      orders=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('ordersProcessed', 0))")
      echo "      ✅ $orders orders"
      ((SUCCESS_COUNT++))
      ((TOTAL_ORDERS+=orders))
    else
      error=$(echo $response | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('error', 'Unknown error'))" 2>/dev/null)
      echo "      ❌ Failed - $error"
      ((FAILED_COUNT++))
    fi

    # Small delay between shops
    sleep 1
  done

  echo ""
done

echo "📊 Summary:"
echo "   ✅ Successful jobs: $SUCCESS_COUNT"
echo "   ❌ Failed jobs:     $FAILED_COUNT"
echo "   📦 Total orders:    $TOTAL_ORDERS"
