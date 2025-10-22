#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Re-aggregating ALL data (August 2024 - October 2025)..."
echo ""

# Function to aggregate a full month
aggregate_month() {
  local year=$1
  local month=$2
  local days=$3

  echo "📅 Processing $year-$month (days: $days)..."

  for day in $(seq 1 $days); do
    date=$(printf "%04d-%02d-%02d" $year $month $day)
    echo "  ✓ $date"

    curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"targetDate\": \"$date\"}" > /dev/null

    sleep 0.5  # Reduced sleep for faster execution
  done

  echo ""
}

# 2024
# aggregate_month 2024 8 31   # August 2024
# aggregate_month 2024 9 30   # September 2024
# aggregate_month 2024 10 31  # October 2024
# aggregate_month 2024 11 30  # November 2024
# aggregate_month 2024 12 31  # December 2024

# # 2025
# aggregate_month 2025 1 31   # January 2025
# aggregate_month 2025 2 28   # February 2025
# aggregate_month 2025 3 31   # March 2025
# aggregate_month 2025 4 30   # April 2025
# aggregate_month 2025 5 31   # May 2025
# aggregate_month 2025 6 30   # June 2025
# aggregate_month 2025 7 31   # July 2025
# aggregate_month 2025 8 31   # August 2025
# aggregate_month 2025 9 30   # September 2025
aggregate_month 2025 10 22  # October 2025 (partial - up to 22nd)

echo "✅ Complete re-aggregation finished!"
echo ""
echo "📊 Verify data:"
echo "   SELECT metric_date, shop, order_count, revenue_gross FROM daily_shop_metrics ORDER BY metric_date DESC LIMIT 20;"
