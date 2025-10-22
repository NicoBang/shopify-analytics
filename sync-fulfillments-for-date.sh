#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DATE="2025-09-29"
KEY="${SUPABASE_SERVICE_ROLE_KEY}"

echo "🔄 Syncing fulfillments for $DATE..."
echo ""

# Danish timezone: 2025-09-29 in DK = 2025-09-28T22:00:00Z to 2025-09-29T21:59:59Z
START_UTC="2025-09-28T22:00:00Z"
END_UTC="2025-09-29T21:59:59Z"

# Get all orders from that date
echo "📦 Fetching orders from $DATE..."
orders=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/orders?created_at=gte.$START_UTC&created_at=lte.$END_UTC&select=shop,order_id&limit=1000" \
  -H "apikey: $KEY")

# Extract unique shops and order_ids
shops=$(echo "$orders" | jq -r '.[].shop' | sort -u)

echo "🏪 Found shops: $(echo "$shops" | wc -l | tr -d ' ')"
echo ""

total_synced=0
total_errors=0

for shop in $shops; do
  echo "🔄 Syncing $shop..."

  # Get token for shop
  case $shop in
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
      echo "  ⚠️  Unknown shop: $shop"
      continue
      ;;
  esac

  # Get orders for this shop
  shop_orders=$(echo "$orders" | jq -r ".[] | select(.shop == \"$shop\") | .order_id")
  order_count=$(echo "$shop_orders" | wc -l | tr -d ' ')

  echo "  📦 Processing $order_count orders..."

  for order_id in $shop_orders; do
    # Fetch order details to get shipping country
    order_response=$(curl -s "https://$shop/admin/api/2025-01/orders/$order_id.json" \
      -H "X-Shopify-Access-Token: $TOKEN")

    # Get shipping country from order
    shipping_country=$(echo "$order_response" | jq -r '.order.shipping_address.country_code // "DK"')

    # Fetch fulfillments from Shopify
    response=$(curl -s "https://$shop/admin/api/2025-01/orders/$order_id/fulfillments.json" \
      -H "X-Shopify-Access-Token: $TOKEN")

    # Check if there are fulfillments
    fulfillment_count=$(echo "$response" | jq '.fulfillments | length' 2>/dev/null || echo "0")

    if [ "$fulfillment_count" -gt 0 ]; then
      # Extract fulfillment data
      echo "$response" | jq -c '.fulfillments[]' | while read -r fulfillment; do
        created_at=$(echo "$fulfillment" | jq -r '.created_at')
        tracking_company=$(echo "$fulfillment" | jq -r '.tracking_company // "unknown"')
        item_count=$(echo "$fulfillment" | jq -r '.line_items | length')

        # Use shipping country from order (not origin location)
        country="$shipping_country"

        # Insert into fulfillments table
        curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments" \
          -H "apikey: $KEY" \
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
          }" >/dev/null 2>&1

        if [ $? -eq 0 ]; then
          ((total_synced++))
          echo "    ✅ Order $order_id"
        else
          ((total_errors++))
          echo "    ❌ Order $order_id (error)"
        fi
      done
    fi

    # Rate limiting
    sleep 0.5
  done

  echo ""
done

echo "✅ Done!"
echo "   Synced: $total_synced fulfillments"
echo "   Errors: $total_errors"
