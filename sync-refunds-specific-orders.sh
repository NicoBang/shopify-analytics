#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

KEY="${SUPABASE_SERVICE_ROLE_KEY}"
TOKEN_DA="${SHOPIFY_TOKEN_DA}"
TOKEN_DE="${SHOPIFY_TOKEN_DE}"

ORDERS=(
  "7802698105166:pompdelux-da.myshopify.com:$TOKEN_DA"
  "6783229100371:pompdelux-de.myshopify.com:$TOKEN_DE"
  "6783823282515:pompdelux-de.myshopify.com:$TOKEN_DE"
)

echo "🔄 Syncing refunds for ${#ORDERS[@]} orders..."
echo ""

for order_info in "${ORDERS[@]}"; do
  IFS=':' read -r order_id shop token <<< "$order_info"
  
  echo "📦 Order $order_id ($shop)..."
  
  # Check current fulfillment state
  echo "  📊 BEFORE refund sync:"
  curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?order_id=eq.$order_id&select=order_id,refunded_qty,refund_date,item_count" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq -r '.[] | "    refunded_qty: \(.refunded_qty // 0), refund_date: \(.refund_date // "null"), item_count: \(.item_count)"'
  
  # Fetch refunds from Shopify
  refunds=$(curl -s "https://$shop/admin/api/2025-01/orders/$order_id/refunds.json" \
    -H "X-Shopify-Access-Token: $token")
  
  refund_count=$(echo "$refunds" | jq '.refunds | length')
  
  if [ "$refund_count" = "0" ] || [ "$refund_count" = "null" ]; then
    echo "  ✅ No refunds in Shopify (as expected)"
  else
    echo "  🔍 Found $refund_count refund(s) in Shopify"
    
    # Show refund summary
    echo "$refunds" | jq -r '.refunds[] | "    - Created: \(.created_at), Items: \(.refund_line_items | length)"'
  fi
  
  echo ""
done

echo "🚀 Calling bulk-sync-refunds Edge Function..."
echo ""

# Call bulk-sync-refunds for these specific orders
response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-09-09",
    "endDate": "2025-09-09"
  }')

echo "Response: $response"
echo ""

response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-de.myshopify.com",
    "startDate": "2025-07-30",
    "endDate": "2025-07-31"
  }')

echo "Response: $response"
echo ""

sleep 2

echo "📊 AFTER refund sync - checking for duplicates:"
echo ""

for order_info in "${ORDERS[@]}"; do
  IFS=':' read -r order_id shop token <<< "$order_info"
  
  echo "📦 Order $order_id:"
  
  # Count duplicates
  dup_count=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?order_id=eq.$order_id&select=id" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq 'length')
  
  if [ "$dup_count" -gt 1 ]; then
    echo "  ❌ DUPLICATE: Found $dup_count rows!"
  else
    echo "  ✅ No duplicates ($dup_count row)"
  fi
  
  # Show current state
  curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?order_id=eq.$order_id&select=order_id,refunded_qty,refund_date,item_count,created_at" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq -r '.[] | "    refunded_qty: \(.refunded_qty // 0), refund_date: \(.refund_date // "null"), created_at: \(.created_at)"'
  
  echo ""
done

echo "✅ Done!"
