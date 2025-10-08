#!/bin/bash

# Complete sync script - syncs BOTH orders AND SKUs for all shops
# Usage: ./sync-complete.sh START_DATE END_DATE

set -e

START_DATE=${1:-"2025-10-07"}
END_DATE=${2:-"2025-10-07"}

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Complete sync from $START_DATE to $END_DATE"
echo "   Syncing BOTH orders AND SKUs for all shops"
echo ""

total_orders=0
total_skus=0

for shop in "${SHOPS[@]}"; do
  echo "📦 Syncing $shop..."

  # 1. Sync Orders
  echo "   📋 Orders..."
  orders_result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"shop\":\"$shop\",\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}")

  orders_synced=$(echo "$orders_result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('ordersProcessed', 0))" 2>/dev/null || echo "0")
  total_orders=$((total_orders + orders_synced))
  echo "      ✅ $orders_synced orders"

  # 2. Sync SKUs
  echo "   📦 SKUs..."
  skus_result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"shop\":\"$shop\",\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}")

  skus_synced=$(echo "$skus_result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(sum(d.get('skusProcessed', 0) for d in r.get('results', [])))" 2>/dev/null || echo "0")
  total_skus=$((total_skus + skus_synced))
  echo "      ✅ $skus_synced SKUs"

  echo ""
done

echo "🎉 Complete sync finished!"
echo "   Total: $total_orders orders, $total_skus SKUs"
