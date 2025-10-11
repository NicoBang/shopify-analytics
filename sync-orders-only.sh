#!/bin/bash

# Sync ONLY orders (not SKUs) for all shops
# Usage: ./sync-orders-only.sh START_DATE END_DATE

set -e

START_DATE=${1:-"2025-10-11"}
END_DATE=${2:-"2025-10-11"}

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Syncing ONLY orders from $START_DATE to $END_DATE"
echo "   (Skipping SKUs - those are handled separately)"
echo "=================================================="
echo ""

total_orders=0
failed_shops=""

for shop in "${SHOPS[@]}"; do
  echo "📦 Processing $shop..."

  result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"shop\":\"$shop\",\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\",\"testMode\":false}")

  # Parse the response
  success=$(echo "$result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null || echo "false")
  records=$(echo "$result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('details', {}).get('totalRecords', 0))" 2>/dev/null || echo "0")

  if [ "$success" = "True" ]; then
    echo "   ✅ Synced $records orders"
    total_orders=$((total_orders + records))
  else
    echo "   ❌ Failed to sync orders"
    echo "   Response: $result"
    failed_shops="$failed_shops $shop"
  fi
  echo ""
done

echo "=================================================="
echo "📊 Summary:"
echo "   Total orders synced: $total_orders"
if [ -n "$failed_shops" ]; then
  echo "   ⚠️ Failed shops: $failed_shops"
fi
echo ""
echo "✅ Orders sync complete!"
echo ""
echo "Note: SKUs must be synced separately using bulk-sync-skus"