#!/bin/bash
set -e

echo "🔄 Retrying Failed Refund Periods (Day-by-Day)"
echo "=============================================="
echo ""

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

# Failed periods (split into single days)
FAILED_PERIODS=(
  "2024-10-21 2024-10-27"
  "2024-10-28 2024-11-03"
  "2024-12-09 2024-12-15"
  "2024-12-16 2024-12-22"
  "2025-01-08 2025-01-14"
  "2025-01-15 2025-01-21"
  "2025-01-22 2025-01-28"
  "2025-05-21 2025-05-27"
  "2025-06-18 2025-06-24"
  "2025-07-09 2025-07-15"
  "2025-07-16 2025-07-22"
  "2025-07-30 2025-08-05"
  "2025-08-06 2025-08-12"
  "2025-08-13 2025-08-19"
  "2025-08-27 2025-09-02"
  "2025-09-24 2025-09-30"
)

# Function to generate date range
generate_dates() {
  local start=$1
  local end=$2

  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    current=$(date -j -f "%Y-%m-%d" "$start" "+%s")
    end_ts=$(date -j -f "%Y-%m-%d" "$end" "+%s")

    while [ $current -le $end_ts ]; do
      date -j -f "%s" "$current" "+%Y-%m-%d"
      current=$((current + 86400))
    done
  else
    # Linux
    current=$(date -d "$start" "+%s")
    end_ts=$(date -d "$end" "+%s")

    while [ $current -le $end_ts ]; do
      date -d "@$current" "+%Y-%m-%d"
      current=$((current + 86400))
    done
  fi
}

total_periods=${#FAILED_PERIODS[@]}
current_period=0

for period in "${FAILED_PERIODS[@]}"; do
  current_period=$((current_period + 1))
  read -r start_date end_date <<< "$period"

  echo "📅 Period $current_period/$total_periods: $start_date to $end_date"
  echo "---------------------------------------------------"

  # Generate individual dates
  dates=($(generate_dates "$start_date" "$end_date"))
  total_days=${#dates[@]}
  current_day=0

  for date in "${dates[@]}"; do
    current_day=$((current_day + 1))
    echo -n "  Day $current_day/$total_days ($date): "

    # Call backfill-refund-amounts for single day (dryRun: false to actually update)
    response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-refund-amounts" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"startDate\": \"$date\", \"endDate\": \"$date\", \"dryRun\": false}" \
      --max-time 120)

    # Check if successful
    if echo "$response" | grep -q '"success":true'; then
      skus_checked=$(echo "$response" | grep -o '"skusChecked":[0-9]*' | cut -d':' -f2)
      skus_updated=$(echo "$response" | grep -o '"skusUpdated":[0-9]*' | cut -d':' -f2)

      if [ -z "$skus_updated" ]; then
        # Dry run response (updatesNeeded instead of skusUpdated)
        updates_needed=$(echo "$response" | grep -o '"updatesNeeded":[0-9]*' | cut -d':' -f2)
        echo "⚠️  Checked: $skus_checked, Updates needed: $updates_needed (DRY RUN?)"
      else
        echo "✅ Checked: $skus_checked, Updated: $skus_updated"
      fi
    else
      echo "❌ Failed - $response"
    fi

    # Small delay to avoid rate limiting
    sleep 0.5
  done

  echo ""
done

echo ""
echo "✅ Done! All failed periods retried day-by-day"
echo ""
echo "Verify results:"
echo "  Check orders: SELECT COUNT(*) FROM orders WHERE shipping_refund_dkk IS NOT NULL;"
echo "  Check SKUs: SELECT COUNT(*) FROM skus WHERE refunded_amount_dkk > 0;"
