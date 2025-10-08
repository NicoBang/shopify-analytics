#!/bin/bash

# Safe complete sync - runs BOTH orders AND SKUs in 7-day chunks
# Usage: ./sync-complete-safe.sh START_DATE END_DATE

set -e

START_DATE=${1:-"2025-05-01"}
END_DATE=${2:-"2025-10-07"}
CHUNK_DAYS=7

echo "🔄 Starting safe COMPLETE sync from $START_DATE to $END_DATE"
echo "   Processing BOTH orders AND SKUs in $CHUNK_DAYS-day chunks"
echo ""

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

# Convert dates to seconds
start_sec=$(date -j -f "%Y-%m-%d" "$START_DATE" "+%s")
end_sec=$(date -j -f "%Y-%m-%d" "$END_DATE" "+%s")

current_sec=$start_sec
total_orders=0
total_skus=0
chunk_num=1

while [ $current_sec -le $end_sec ]; do
  # Calculate chunk end (7 days or end_date)
  chunk_end_sec=$((current_sec + (CHUNK_DAYS * 86400)))
  if [ $chunk_end_sec -gt $end_sec ]; then
    chunk_end_sec=$end_sec
  fi

  chunk_start=$(date -j -f "%s" "$current_sec" "+%Y-%m-%d")
  chunk_end=$(date -j -f "%s" "$chunk_end_sec" "+%Y-%m-%d")

  echo "📦 Chunk $chunk_num: $chunk_start to $chunk_end"

  # Sync ALL shops for this chunk
  for shop in "${SHOPS[@]}"; do
    echo "   🏪 $shop"

    # Orders
    orders_result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"shop\":\"$shop\",\"startDate\":\"$chunk_start\",\"endDate\":\"$chunk_end\"}")

    orders=$(echo "$orders_result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('ordersProcessed', 0))" 2>/dev/null || echo "0")
    total_orders=$((total_orders + orders))

    # SKUs
    skus_result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"shop\":\"$shop\",\"startDate\":\"$chunk_start\",\"endDate\":\"$chunk_end\"}")

    skus=$(echo "$skus_result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(sum(d.get('skusProcessed', 0) for d in r.get('results', [])))" 2>/dev/null || echo "0")
    total_skus=$((total_skus + skus))

    echo "      ✅ $orders orders, $skus SKUs"
  done

  echo ""

  # Move to next chunk
  current_sec=$((chunk_end_sec + 86400))
  chunk_num=$((chunk_num + 1))

  # Delay between chunks
  sleep 2
done

echo ""
echo "🎉 Complete sync finished!"
echo "   Total: $total_orders orders, $total_skus SKUs"
echo "   Log: complete-sync.log"
