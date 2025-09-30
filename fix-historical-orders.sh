#!/bin/bash

# Shopify Analytics - Fix Historical Order Data
# Retter forkert aggregering af refunded_qty og cancelled_qty i orders tabellen

API_BASE="https://shopify-analytics-kfnrp3zgx-nicolais-projects-291e9559.vercel.app"
API_KEY="bda5da3d49fe0e7391fded3895b5c6bc"
BATCH_SIZE=50
OFFSET=0
TOTAL_FIXED=0
TOTAL_CHECKED=0

echo "🔧 Starter fix af historiske ordre data..."
echo "📊 Batch størrelse: $BATCH_SIZE ordrer ad gangen"
echo ""

while true; do
    echo "📦 Behandler batch: offset $OFFSET"

    # Kald fix API
    RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
        "$API_BASE/api/fix-historical-data?batchSize=$BATCH_SIZE&offset=$OFFSET")

    # Parse response
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
    FIXED=$(echo "$RESPONSE" | jq -r '.fixed // 0')
    CHECKED=$(echo "$RESPONSE" | jq -r '.checked // 0')
    HAS_MORE=$(echo "$RESPONSE" | jq -r '.hasMore // false')
    NEXT_OFFSET=$(echo "$RESPONSE" | jq -r '.nextOffset // null')

    if [ "$SUCCESS" != "true" ]; then
        echo "❌ Fejl i batch på offset $OFFSET:"
        echo "$RESPONSE" | jq '.'
        exit 1
    fi

    # Opdater totaler
    TOTAL_FIXED=$((TOTAL_FIXED + FIXED))
    TOTAL_CHECKED=$((TOTAL_CHECKED + CHECKED))

    echo "   ✅ Rettet: $FIXED ud af $CHECKED ordrer"
    echo "   📊 Total rettet: $TOTAL_FIXED ud af $TOTAL_CHECKED"

    # Vis eventuelle fixes (første 3)
    FIXES=$(echo "$RESPONSE" | jq -r '.fixes[]? | "   🔧 Order \(.order_id): refunded \(.old_refunded)→\(.new_refunded), cancelled \(.old_cancelled)→\(.new_cancelled)"' | head -3)
    if [ -n "$FIXES" ]; then
        echo "$FIXES"
    fi

    # Check om der er flere
    if [ "$HAS_MORE" != "true" ] || [ "$NEXT_OFFSET" == "null" ]; then
        break
    fi

    OFFSET=$NEXT_OFFSET
    echo ""

    # Pause mellem batches for at være rar ved serveren
    sleep 1
done

echo ""
echo "🎯 Fix fuldført!"
echo "📊 Total ordrer tjekket: $TOTAL_CHECKED"
echo "🔧 Total ordrer rettet: $TOTAL_FIXED"

if [ $TOTAL_FIXED -gt 0 ]; then
    echo ""
    echo "✅ Historiske data er nu konsistente mellem orders og skus tabeller"
    echo "📈 Dashboard og Style Analytics vil nu vise ens return tal"
else
    echo "ℹ️  Ingen ordrer behøvede rettelse - data var allerede konsistente"
fi