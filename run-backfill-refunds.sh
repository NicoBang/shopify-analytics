#!/bin/bash

# run-backfill-refunds.sh
# Safely backfills refunded_amount_dkk in weekly batches to avoid timeouts

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# Usage
if [ $# -lt 2 ]; then
  echo "Usage: $0 <startDate> <endDate> [dryRun]"
  echo "Example: $0 2025-09-01 2025-09-30 true"
  echo "         $0 2024-01-01 2025-10-31 false  # Run for real"
  exit 1
fi

START_DATE="$1"
END_DATE="$2"
DRY_RUN="${3:-true}"

echo "🔄 Backfilling refunded_amount_dkk"
echo "   Start: $START_DATE"
echo "   End: $END_DATE"
echo "   Dry Run: $DRY_RUN"
echo ""

if [ "$DRY_RUN" = "false" ]; then
  echo "⚠️  WARNING: This will UPDATE database! Press Ctrl+C to cancel, or Enter to continue..."
  read
fi

# Convert dates to timestamps for iteration
current=$(date -j -f "%Y-%m-%d" "$START_DATE" "+%s")
end=$(date -j -f "%Y-%m-%d" "$END_DATE" "+%s")
week_seconds=$((7 * 24 * 60 * 60))

total_checked=0
total_updated=0
batch_num=0

while [ $current -le $end ]; do
  batch_num=$((batch_num + 1))

  # Calculate batch end date (min of current+7days or end date)
  batch_end=$((current + week_seconds))
  if [ $batch_end -gt $end ]; then
    batch_end=$end
  fi

  # Format dates
  batch_start=$(date -j -f "%s" "$current" "+%Y-%m-%d")
  batch_end_date=$(date -j -f "%s" "$batch_end" "+%Y-%m-%d")

  echo "📅 Batch $batch_num: $batch_start to $batch_end_date"

  # Call Edge Function
  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-refund-amounts" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"startDate\":\"$batch_start\",\"endDate\":\"$batch_end_date\",\"dryRun\":$DRY_RUN}" \
    --max-time 120)

  # Parse response
  success=$(echo "$response" | jq -r '.success // false')

  if [ "$success" = "true" ]; then
    checked=$(echo "$response" | jq -r '.skusChecked // 0')
    updated=$(echo "$response" | jq -r '.skusUpdated // .updatesNeeded // 0')

    total_checked=$((total_checked + checked))
    total_updated=$((total_updated + updated))

    echo "   ✅ Checked: $checked, Updated: $updated"
  else
    error=$(echo "$response" | jq -r '.error // "Unknown error"')
    echo "   ❌ Error: $error"
    echo "   Response: $response"
  fi

  echo ""

  # Move to next week
  current=$((current + week_seconds))

  # Rate limit between batches
  sleep 2
done

echo "✅ Backfill complete!"
echo "   Total SKUs checked: $total_checked"
echo "   Total SKUs updated: $total_updated"

if [ "$DRY_RUN" = "true" ]; then
  echo ""
  echo "⚠️  This was a DRY RUN - no changes were made."
  echo "   To apply changes, run: $0 $START_DATE $END_DATE false"
fi
