#!/bin/bash

# Re-aggregate all historical data using aggregate-daily-metrics Edge Function
# This fixes refund counting to use refund_date instead of created_at

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
URL="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics"

START_DATE="2024-09-01"
END_DATE=$(date +%Y-%m-%d)

echo "🔄 Re-aggregating historical data from $START_DATE to $END_DATE"
echo ""

current_date="$START_DATE"

while [[ "$current_date" < "$END_DATE" ]] || [[ "$current_date" == "$END_DATE" ]]; do
  echo "📊 Processing: $current_date"

  response=$(curl -s -X POST "$URL" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\":\"$current_date\"}" \
    --max-time 30)

  if echo "$response" | grep -q '"success":true'; then
    echo "   ✅ Success"
  else
    echo "   ❌ Failed: $response"
  fi

  # Move to next day
  current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" +%Y-%m-%d)

  # Small delay to avoid rate limiting
  sleep 0.5
done

echo ""
echo "✅ Backfill completed!"
echo ""
echo "Verify results:"
echo "SELECT metric_date, return_quantity, return_amount FROM daily_shop_metrics WHERE metric_date = '2025-10-01' AND shop = 'pompdelux-da.myshopify.com';"
