#!/bin/bash

# Sync Product Metadata Script
# Syncs product metadata for all shops (no date range - fetches current data)

VERCEL_TOKEN="bda5da3d49fe0e7391fded3895b5c6bc"
VERCEL_API="https://shopify-analytics-nu.vercel.app"

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

echo "📦 Syncing product metadata for all shops"
echo ""

for shop in "${SHOPS[@]}"; do
  echo "🏪 Syncing $shop..."
  curl -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/api/sync-shop?shop=$shop&type=metadata" &
done

wait

echo ""
echo "✅ All shops synced with product metadata"
