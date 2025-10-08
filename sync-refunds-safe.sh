#!/bin/bash

# Safe refund sync script - runs 7-day periods to avoid timeout
# Usage: ./sync-refunds-safe.sh START_DATE END_DATE

set -e

START_DATE=${1:-"2025-05-01"}
END_DATE=${2:-"2025-10-07"}
CHUNK_DAYS=7

echo "🔄 Starting safe refund sync from $START_DATE to $END_DATE"
echo "   Processing in $CHUNK_DAYS-day chunks to avoid timeout"
echo ""

# Convert dates to seconds for iteration
start_sec=$(date -j -f "%Y-%m-%d" "$START_DATE" "+%s")
end_sec=$(date -j -f "%Y-%m-%d" "$END_DATE" "+%s")

current_sec=$start_sec
total_orders=0
total_skus=0
chunk_num=1

while [ $current_sec -le $end_sec ]; do
  # Calculate chunk end date (7 days later or end_date, whichever is earlier)
  chunk_end_sec=$((current_sec + (CHUNK_DAYS * 86400)))
  if [ $chunk_end_sec -gt $end_sec ]; then
    chunk_end_sec=$end_sec
  fi

  chunk_start=$(date -j -f "%s" "$current_sec" "+%Y-%m-%d")
  chunk_end=$(date -j -f "%s" "$chunk_end_sec" "+%Y-%m-%d")

  echo "📦 Chunk $chunk_num: $chunk_start to $chunk_end"

  # Run sync for this chunk
  ./sync-date-range-refunds.sh "$chunk_start" "$chunk_end" | tee -a refund-sync.log

  # Extract stats from output (rough estimate)
  chunk_orders=$(grep -o "✅ [0-9]* orders" refund-sync.log | tail -5 | awk '{sum+=$2} END {print sum}')
  total_orders=$((total_orders + chunk_orders))

  echo "   ✅ Chunk complete: ~$chunk_orders orders"
  echo ""

  # Move to next chunk (chunk_end + 1 day)
  current_sec=$((chunk_end_sec + 86400))
  chunk_num=$((chunk_num + 1))

  # Small delay between chunks
  sleep 2
done

echo ""
echo "🎉 All chunks complete!"
echo "   Total: ~$total_orders orders synced"
echo "   Log: refund-sync.log"
