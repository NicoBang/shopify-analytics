#!/bin/bash

# Sync ONLY SKUs (not orders) for all shops
# Usage: ./sync-skus-only.sh START_DATE END_DATE
# Example: ./sync-skus-only.sh 2025-10-01 2025-10-11

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./sync-skus-only.sh START_DATE END_DATE"
  echo "Example: ./sync-skus-only.sh 2025-10-01 2025-10-11"
  exit 1
fi

START_DATE="$1"
END_DATE="$2"

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

echo "🚀 Syncing SKUs for all shops"
echo "   Period: $START_DATE to $END_DATE"
echo "   Shops: ${#SHOPS[@]}"
echo ""

total_skus=0

for shop in "${SHOPS[@]}"; do
  echo "📦 Processing $shop..."

  result=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"shop\":\"$shop\",\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\",\"testMode\":false}")

  # Parse response using Python (more reliable than jq for this)
  success=$(echo "$result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null || echo "false")
  records=$(echo "$result" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('skusProcessed', 0))" 2>/dev/null || echo "0")

  if [ "$success" = "True" ]; then
    echo "   ✅ Synced $records SKUs"
    total_skus=$((total_skus + records))
  else
    echo "   ❌ Failed for $shop"
    echo "   Error: $result"
  fi

  echo ""
done

echo "🎉 Sync complete!"
echo "   Total SKUs synced: $total_skus"
