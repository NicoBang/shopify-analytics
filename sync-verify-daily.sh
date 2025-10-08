#!/bin/bash

# Sync verification data day-by-day to avoid timeouts
# Usage: ./sync-verify-daily.sh START_DATE END_DATE SHOP
# Example: ./sync-verify-daily.sh 2025-10-01 2025-10-07 pompdelux-da.myshopify.com

START_DATE="$1"
END_DATE="$2"
SHOP="${3:-pompdelux-da.myshopify.com}"

if [ -z "$START_DATE" ] || [ -z "$END_DATE" ]; then
  echo "Usage: $0 START_DATE END_DATE [SHOP]"
  echo "Example: $0 2025-10-01 2025-10-07 pompdelux-da.myshopify.com"
  exit 1
fi

echo "🔍 Daily verification sync"
echo "   Shop: $SHOP"
echo "   Period: $START_DATE → $END_DATE"
echo ""

TOTAL_SYNCED=0
CURRENT_DATE="$START_DATE"

while [ "$CURRENT_DATE" != "$END_DATE" ]; do
  # Calculate next day
  NEXT_DATE=$(date -j -v+1d -f "%Y-%m-%d" "$CURRENT_DATE" +%Y-%m-%d 2>/dev/null || date -d "$CURRENT_DATE + 1 day" +%Y-%m-%d)

  echo "📅 Syncing $CURRENT_DATE..."

  RESPONSE=$(curl -s -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
    "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$SHOP&type=verify-skus&startDate=$CURRENT_DATE&endDate=$NEXT_DATE")

  # Extract counts
  VERIFIED=$(echo "$RESPONSE" | grep -o '"skusVerified":[0-9]*' | grep -o '[0-9]*')
  SKIPPED=$(echo "$RESPONSE" | grep -o '"skusSkipped":[0-9]*' | grep -o '[0-9]*')

  if [ -n "$VERIFIED" ]; then
    echo "   ✅ Verified: $VERIFIED, Skipped: $SKIPPED"
    TOTAL_SYNCED=$((TOTAL_SYNCED + VERIFIED))
  else
    echo "   ❌ Error: $RESPONSE"
  fi

  # Move to next date
  CURRENT_DATE="$NEXT_DATE"

  # Small delay to avoid rate limits
  sleep 1
done

echo ""
echo "✅ Daily sync complete!"
echo "   Total multi-quantity SKUs synced: $TOTAL_SYNCED"
