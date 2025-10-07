#!/bin/bash

# Sync all SKUs to verification table using fast non-Bulk API
# This will sync correct prices for comparison with existing data
#
# Usage: ./sync-verify-all.sh [START_DATE] [END_DATE]
# Example: ./sync-verify-all.sh 2025-08-01 2025-09-30

START_DATE="${1:-2025-08-01}"
END_DATE="${2:-2025-09-30}"

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

echo "🔍 Starting SKU verification sync..."
echo "   Period: $START_DATE → $END_DATE"
echo "   Shops: ${#SHOPS[@]}"
echo ""

TOTAL_SYNCED=0

for shop in "${SHOPS[@]}"; do
  echo "📦 Syncing $shop..."

  RESPONSE=$(curl -s -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
    "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=verify-skus&startDate=$START_DATE&endDate=$END_DATE")

  # Extract count from response
  COUNT=$(echo "$RESPONSE" | grep -o '"skusVerified":[0-9]*' | grep -o '[0-9]*')

  if [ -n "$COUNT" ]; then
    echo "   ✅ Synced $COUNT SKUs from $shop"
    TOTAL_SYNCED=$((TOTAL_SYNCED + COUNT))
  else
    echo "   ❌ Error syncing $shop"
    echo "   Response: $RESPONSE"
  fi

  echo ""
done

echo ""
echo "✅ Verification sync complete!"
echo "   Total SKUs synced: $TOTAL_SYNCED"
echo ""
echo "Next steps:"
echo "1. Run: psql -f migrations/merge_verified_sku_prices.sql"
echo "2. Verify results in database"
echo "3. Drop verification table when confirmed correct"
