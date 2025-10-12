#!/bin/bash
# Fix VAT-inclusive prices in all historical orders

API_URL="https://shopify-analytics-nu.vercel.app"
API_KEY="bda5da3d49fe0e7391fded3895b5c6bc"
BATCH_SIZE=50

SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

for SHOP in "${SHOPS[@]}"; do
  echo ""
  echo "========================================="
  echo "🏪 Processing shop: $SHOP"
  echo "========================================="

  OFFSET=0
  HAS_MORE=true
  TOTAL_CORRECTED=0

  while [ "$HAS_MORE" = "true" ]; do
    echo ""
    echo "📦 Processing batch starting at offset $OFFSET..."

    RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
      "$API_URL/api/fix-historical-vat?shop=$SHOP&batchSize=$BATCH_SIZE&offset=$OFFSET&dryRun=false")

    # Extract values using grep and sed
    CORRECTED=$(echo "$RESPONSE" | grep -o '"correctionsNeeded":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$RESPONSE" | grep -o '"ordersUpdated":[0-9]*' | grep -o '[0-9]*')
    HAS_MORE=$(echo "$RESPONSE" | grep -o '"hasMore":[^,}]*' | grep -o 'true\|false')

    echo "   ✅ Corrected: $CORRECTED orders"
    echo "   💾 Updated: $UPDATED records"

    TOTAL_CORRECTED=$((TOTAL_CORRECTED + CORRECTED))
    OFFSET=$((OFFSET + BATCH_SIZE))

    # Rate limiting
    sleep 2

    # Safety check - stop if something goes wrong
    if [ -z "$CORRECTED" ] || [ -z "$UPDATED" ]; then
      echo "   ⚠️  Warning: Invalid response, stopping"
      HAS_MORE=false
    fi

    # Stop if no more results
    if [ "$HAS_MORE" != "true" ]; then
      break
    fi
  done

  echo ""
  echo "✅ Completed $SHOP: $TOTAL_CORRECTED total corrections"
done

echo ""
echo "========================================="
echo "🎉 All shops processed!"
echo "========================================="
