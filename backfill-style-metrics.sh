#!/bin/bash

# Backfill style metrics (color, SKU, number) for entire dataset
# Usage: ./backfill-style-metrics.sh

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
URL="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-style-metrics"

echo "🎨 Backfilling Style Metrics..."
echo "⚠️  This will aggregate Color, SKU, and Number metrics for August 2024 - October 2025"
echo ""

aggregate_month() {
  local year=$1
  local month=$2
  local days=$3

  echo "📅 Processing $year-$month ($days days)..."

  for day in $(seq 1 $days); do
    date=$(printf "%04d-%02d-%02d" $year $month $day)
    echo -n "  $date: "

    response=$(curl -s -X POST "$URL" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"targetDate\": \"$date\"}")

    success=$(echo $response | grep -o '"success":true' || echo "")
    if [ -n "$success" ]; then
      echo "✅"
    else
      echo "❌ $response"
    fi

    sleep 0.3
  done
}

# August 2024 - October 2025
aggregate_month 2024 8 31
aggregate_month 2024 9 30
aggregate_month 2024 10 31
aggregate_month 2024 11 30
aggregate_month 2024 12 31

aggregate_month 2025 1 31
aggregate_month 2025 2 28
aggregate_month 2025 3 31
aggregate_month 2025 4 30
aggregate_month 2025 5 31
aggregate_month 2025 6 30
aggregate_month 2025 7 31
aggregate_month 2025 8 31
aggregate_month 2025 9 30
aggregate_month 2025 10 16  # Only up to today

echo ""
echo "✅ Backfill complete!"
echo ""
echo "To verify:"
echo "  curl -s \"https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_color_metrics?select=count\" \\"
echo "    -H \"Authorization: Bearer $KEY\" -H \"apikey: $KEY\" -H \"Prefer: count=exact\""
