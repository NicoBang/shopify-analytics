#!/bin/bash

# Sync Fulfillments Script
# Syncs fulfillment data for all shops for a given date range

if [ "$#" -ne 2 ]; then
  echo "Usage: ./sync-fulfillments.sh START_DATE END_DATE"
  echo "Example: ./sync-fulfillments.sh 2025-10-01 2025-10-07"
  exit 1
fi

START_DATE="$1"
END_DATE="$2"

VERCEL_TOKEN="bda5da3d49fe0e7391fded3895b5c6bc"
VERCEL_API="https://shopify-analytics-9ckj1fm3r-nicolais-projects-291e9559.vercel.app"

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

echo "📦 Syncing fulfillments for $START_DATE to $END_DATE"
echo ""

for shop in "${SHOPS[@]}"; do
  echo "🏪 Syncing $shop..."
  curl -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/api/sync-shop?shop=$shop&type=fulfillments&startDate=$START_DATE&endDate=$END_DATE" &
done

wait

echo ""
echo "✅ All shops synced with fulfillments"
