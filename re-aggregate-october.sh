#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Re-aggregating daily_shop_metrics for October 2025..."
echo ""

start_date="2025-10-01"
end_date="2025-10-31"

# Calculate total days
total_days=31
current_day=0

# Loop through each date in October
current_date="$start_date"
while [[ "$current_date" < "$end_date" ]] || [[ "$current_date" == "$end_date" ]]; do
  ((current_day++))
  pct=$((current_day * 100 / total_days))

  echo "[$current_day/$total_days - $pct%] Aggregating $current_date..."

  # Call aggregate-daily-metrics for this date
  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\":\"$current_date\"}" \
    --max-time 60)

  # Check if successful
  if echo "$response" | grep -q "success"; then
    echo "   ✅ Success"
  else
    echo "   ⚠️  Response: $response"
  fi

  # Move to next day
  current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d")

  # Small delay to avoid rate limiting
  sleep 0.5
done

echo ""
echo "✅ October 2025 re-aggregation complete!"
echo ""
echo "📊 Verify results:"
echo "SELECT metric_date, SUM(revenue_gross) as revenue, SUM(return_amount) as returns"
echo "FROM daily_shop_metrics"
echo "WHERE metric_date >= '2025-10-01' AND metric_date <= '2025-10-31'"
echo "GROUP BY metric_date"
echo "ORDER BY metric_date;"
