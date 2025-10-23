#!/bin/bash

# backfill-all-historical-data.sh
# Safely backfills refunded_amount_dkk for ALL historical data
# Processes data week-by-week to avoid timeouts (based on test showing monthly fails)

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "🔄 Historical refunded_amount_dkk Backfill"
echo "========================================="
echo ""
echo "This will update refunded_amount_dkk for ALL historical orders"
echo "from 2024-01-01 to $(date +%Y-%m-%d)"
echo ""
echo "Strategy: Weekly batches (7 days per batch)"
echo "Expected time: ~30-45 minutes"
echo ""
echo "⚠️  WARNING: This will UPDATE the database!"
echo ""
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

START_TIME=$(date +%s)
TOTAL_CHECKED=0
TOTAL_UPDATED=0
FAILED_BATCHES=()
BATCH_NUM=0

# Function to process a date range
process_batch() {
  local start_date=$1
  local end_date=$2

  BATCH_NUM=$((BATCH_NUM + 1))
  echo ""
  echo "📆 Batch $BATCH_NUM: $start_date to $end_date"

  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-refund-amounts" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"startDate\":\"$start_date\",\"endDate\":\"$end_date\",\"dryRun\":false}" \
    --max-time 180)

  success=$(echo "$response" | jq -r '.success // false')

  if [ "$success" = "true" ]; then
    checked=$(echo "$response" | jq -r '.skusChecked // 0')
    updated=$(echo "$response" | jq -r '.skusUpdated // 0')

    TOTAL_CHECKED=$((TOTAL_CHECKED + checked))
    TOTAL_UPDATED=$((TOTAL_UPDATED + updated))

    echo "   ✅ Checked: $checked, Updated: $updated"
  else
    error=$(echo "$response" | jq -r '.error // "Unknown error"')
    echo "   ❌ Failed: $error"
    FAILED_BATCHES+=("$start_date to $end_date")
  fi

  # Rate limit between batches
  sleep 2
}

# Process 2024 data (weekly)
echo ""
echo "📅 Processing 2024 data (weekly batches)..."
echo "============================================"

current=$(date -j -f "%Y-%m-%d" "2024-01-01" "+%s")
end_2024=$(date -j -f "%Y-%m-%d" "2024-12-31" "+%s")
week_seconds=$((7 * 24 * 60 * 60))

while [ $current -le $end_2024 ]; do
  # Calculate batch end (7 days or end of 2024)
  batch_end=$((current + week_seconds - 86400)) # -1 day because we want inclusive ranges
  if [ $batch_end -gt $end_2024 ]; then
    batch_end=$end_2024
  fi

  start_date=$(date -j -f "%s" "$current" "+%Y-%m-%d")
  end_date=$(date -j -f "%s" "$batch_end" "+%Y-%m-%d")

  process_batch "$start_date" "$end_date"

  # Move to next week
  current=$((batch_end + 86400)) # +1 day to start next week
done

# Process 2025 data (weekly)
echo ""
echo "📅 Processing 2025 data (weekly batches)..."
echo "============================================"

current=$(date -j -f "%Y-%m-%d" "2025-01-01" "+%s")
end_2025=$(date "+%s")

while [ $current -le $end_2025 ]; do
  # Calculate batch end (7 days or today)
  batch_end=$((current + week_seconds - 86400))
  if [ $batch_end -gt $end_2025 ]; then
    batch_end=$end_2025
  fi

  start_date=$(date -j -f "%s" "$current" "+%Y-%m-%d")
  end_date=$(date -j -f "%s" "$batch_end" "+%Y-%m-%d")

  process_batch "$start_date" "$end_date"

  # Move to next week
  current=$((batch_end + 86400))
done

# Final summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "========================================="
echo "✅ Historical Backfill Complete!"
echo "========================================="
echo ""
echo "📊 Statistics:"
echo "   Total batches: $BATCH_NUM"
echo "   Total SKUs checked: $TOTAL_CHECKED"
echo "   Total SKUs updated: $TOTAL_UPDATED"
echo "   Time taken: ${MINUTES}m ${SECONDS}s"
echo ""

if [ ${#FAILED_BATCHES[@]} -gt 0 ]; then
  echo "⚠️  Failed batches (you can retry these):"
  for batch in "${FAILED_BATCHES[@]}"; do
    echo "   - $batch"
  done
  echo ""
  echo "To retry a failed batch:"
  echo "   IFS=' to ' read -r start end <<< \"$batch\""
  echo "   ./run-backfill-refunds.sh \$start \$end false"
  echo ""
fi

echo "✅ All historical refunded_amount_dkk values have been updated!"
echo ""
