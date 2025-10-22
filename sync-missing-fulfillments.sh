#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

KEY="${SUPABASE_SERVICE_ROLE_KEY}"

MISSING_ORDERS=(
  "7802698105166"
  "6783229100371"
  "6783823282515"
  "6850837086547"
)

echo "🔍 Syncing ${#MISSING_ORDERS[@]} missing fulfillments..."
echo ""

for order_id in "${MISSING_ORDERS[@]}"; do
  echo "📦 Processing order $order_id..."

  # Get shop and created_at from orders table
  order_data=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/orders?order_id=eq.$order_id&select=shop,created_at" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY")

  shop=$(echo "$order_data" | jq -r '.[0].shop')
  created_at=$(echo "$order_data" | jq -r '.[0].created_at')

  if [ "$shop" = "null" ] || [ -z "$shop" ]; then
    echo "  ❌ Order not found in database"
    continue
  fi

  echo "  Shop: $shop"
  echo "  Created: $created_at"

  # Determine Shopify token based on shop
  case "$shop" in
    "pompdelux-da.myshopify.com")
      TOKEN="${SHOPIFY_TOKEN_DA}"
      ;;
    "pompdelux-de.myshopify.com")
      TOKEN="${SHOPIFY_TOKEN_DE}"
      ;;
    "pompdelux-nl.myshopify.com")
      TOKEN="${SHOPIFY_TOKEN_NL}"
      ;;
    "pompdelux-int.myshopify.com")
      TOKEN="${SHOPIFY_TOKEN_INT}"
      ;;
    "pompdelux-chf.myshopify.com")
      TOKEN="${SHOPIFY_TOKEN_CHF}"
      ;;
    *)
      echo "  ❌ Unknown shop: $shop"
      continue
      ;;
  esac

  # Fetch fulfillments from Shopify
  fulfillments=$(curl -s "https://$shop/admin/api/2025-01/orders/$order_id/fulfillments.json" \
    -H "X-Shopify-Access-Token: $TOKEN")

  # Check if fulfillments exist
  count=$(echo "$fulfillments" | jq '.fulfillments | length')

  if [ "$count" = "0" ] || [ "$count" = "null" ]; then
    echo "  ⚠️  No fulfillments found in Shopify"
    continue
  fi

  echo "  Found $count fulfillment(s)"

  # Extract first fulfillment data
  tracking_company=$(echo "$fulfillments" | jq -r '.fulfillments[0].tracking_company // ""')
  destination=$(echo "$fulfillments" | jq -r '.fulfillments[0].destination // {}')
  country=$(echo "$destination" | jq -r '.country_code // ""')
  item_count=$(echo "$fulfillments" | jq '[.fulfillments[0].line_items[].quantity] | add')

  echo "  Country: $country"
  echo "  Carrier: $tracking_company"
  echo "  Items: $item_count"

  # Insert into fulfillments table
  insert_response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d "{
      \"shop\": \"$shop\",
      \"order_id\": \"$order_id\",
      \"date\": \"$created_at\",
      \"country\": \"$country\",
      \"carrier\": \"$tracking_company\",
      \"item_count\": $item_count,
      \"refunded_qty\": 0
    }")

  if [ -z "$insert_response" ]; then
    echo "  ✅ Inserted successfully"
  else
    echo "  ❌ Error: $insert_response"
  fi

  echo ""
  sleep 0.5
done

echo "✅ Done syncing missing fulfillments"
echo ""
echo "Verify with:"
echo "SELECT order_id, shop, country, carrier, item_count FROM fulfillments WHERE order_id IN ('7802698105166','6783229100371','6783823282515','6850837086547');"
