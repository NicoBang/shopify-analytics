#!/bin/bash

# Sync fulfillments directly from Shopify API without job system
# For the 73 specific missing orders

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

TOKEN_DA="${SHOPIFY_TOKEN_DA}"
TOKEN_DE="${SHOPIFY_TOKEN_DE}"
TOKEN_NL="${SHOPIFY_TOKEN_NL}"
TOKEN_INT="${SHOPIFY_TOKEN_INT}"
KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# Shop to token mapping
declare -A TOKENS
TOKENS["pompdelux-da.myshopify.com"]="$TOKEN_DA"
TOKENS["pompdelux-de.myshopify.com"]="$TOKEN_DE"
TOKENS["pompdelux-nl.myshopify.com"]="$TOKEN_NL"
TOKENS["pompdelux-int.myshopify.com"]="$TOKEN_INT"

# Missing orders
ORDERS=(
  "pompdelux-da.myshopify.com:7728972202318"
  "pompdelux-da.myshopify.com:7729039081806"
  "pompdelux-nl.myshopify.com:7390152950027"
  "pompdelux-int.myshopify.com:7287758487818"
  "pompdelux-nl.myshopify.com:7398770442507"
  "pompdelux-da.myshopify.com:7738774257998"
  "pompdelux-da.myshopify.com:7738804994382"
  "pompdelux-da.myshopify.com:7739671445838"
  "pompdelux-da.myshopify.com:7739713421646"
  "pompdelux-da.myshopify.com:7739811103054"
  "pompdelux-da.myshopify.com:7740726673742"
  "pompdelux-de.myshopify.com:6803138052435"
  "pompdelux-int.myshopify.com:7294764876042"
  "pompdelux-da.myshopify.com:7757313868110"
  "pompdelux-da.myshopify.com:7802698105166"
  "pompdelux-da.myshopify.com:7802903691598"
  "pompdelux-de.myshopify.com:6850837086547"
  "pompdelux-da.myshopify.com:7843616751950"
  "pompdelux-da.myshopify.com:7843621175630"
  "pompdelux-da.myshopify.com:7843625206094"
  "pompdelux-da.myshopify.com:7843627598158"
  "pompdelux-da.myshopify.com:7843635757390"
  "pompdelux-de.myshopify.com:6885151539539"
  "pompdelux-de.myshopify.com:6885200691539"
  "pompdelux-da.myshopify.com:7843827876174"
  "pompdelux-da.myshopify.com:7843828072782"
  "pompdelux-da.myshopify.com:7843987325262"
  "pompdelux-de.myshopify.com:6885394579795"
  "pompdelux-de.myshopify.com:6885416468819"
  "pompdelux-da.myshopify.com:7844055286094"
  "pompdelux-da.myshopify.com:7844077601102"
  "pompdelux-da.myshopify.com:7844088676686"
  "pompdelux-da.myshopify.com:7844128457038"
  "pompdelux-da.myshopify.com:7844136026446"
  "pompdelux-da.myshopify.com:7844492345678"
  "pompdelux-de.myshopify.com:6886363365715"
  "pompdelux-de.myshopify.com:6886397411667"
  "pompdelux-da.myshopify.com:7844972724558"
  "pompdelux-da.myshopify.com:7845013881166"
  "pompdelux-da.myshopify.com:7845025186126"
  "pompdelux-da.myshopify.com:7845029839182"
  "pompdelux-da.myshopify.com:7845033050446"
  "pompdelux-da.myshopify.com:7845055201614"
  "pompdelux-da.myshopify.com:7845068210510"
  "pompdelux-da.myshopify.com:7845082825038"
  "pompdelux-da.myshopify.com:7845092688206"
  "pompdelux-da.myshopify.com:7845097079118"
  "pompdelux-de.myshopify.com:6886597591379"
  "pompdelux-da.myshopify.com:7845124604238"
  "pompdelux-da.myshopify.com:7845137154382"
  "pompdelux-da.myshopify.com:7845141086542"
  "pompdelux-da.myshopify.com:7845179392334"
  "pompdelux-da.myshopify.com:7845187354958"
  "pompdelux-da.myshopify.com:7845214224718"
  "pompdelux-da.myshopify.com:7845217304910"
  "pompdelux-da.myshopify.com:7845228773710"
  "pompdelux-da.myshopify.com:7845229429070"
  "pompdelux-da.myshopify.com:7845260296526"
  "pompdelux-da.myshopify.com:7845302468942"
  "pompdelux-de.myshopify.com:6886999621971"
  "pompdelux-da.myshopify.com:7845382914382"
  "pompdelux-nl.myshopify.com:7589052776715"
  "pompdelux-da.myshopify.com:7845535875406"
  "pompdelux-da.myshopify.com:7845543608654"
  "pompdelux-nl.myshopify.com:7589210325259"
  "pompdelux-da.myshopify.com:7845667438926"
  "pompdelux-nl.myshopify.com:7589347033355"
  "pompdelux-nl.myshopify.com:7614423826699"
  "pompdelux-da.myshopify.com:7858535792974"
  "pompdelux-da.myshopify.com:7868241314126"
  "pompdelux-nl.myshopify.com:7629660717323"
  "pompdelux-de.myshopify.com:6926879293779"
  "pompdelux-nl.myshopify.com:7650603729163"
)

echo "🔄 Direct sync of 73 missing fulfillments..."
echo ""

total=${#ORDERS[@]}
current=0
success=0
failed=0

for entry in "${ORDERS[@]}"; do
  ((current++))
  
  shop="${entry%:*}"
  order_id="${entry#*:}"
  token="${TOKENS[$shop]}"
  
  pct=$((current * 100 / total))
  echo "[$current/$total - $pct%] Fetching $order_id from $shop..."
  
  # Fetch fulfillments from Shopify
  response=$(curl -s "https://$shop/admin/api/2025-01/orders/$order_id/fulfillments.json" \
    -H "X-Shopify-Access-Token: $token")
  
  # Check if response contains fulfillments
  fulfillment_count=$(echo "$response" | jq '.fulfillments | length' 2>/dev/null || echo "0")
  
  if [ "$fulfillment_count" -gt 0 ]; then
    # Process each fulfillment
    echo "$response" | jq -c '.fulfillments[]' | while read -r fulfillment; do
      fulfillment_id=$(echo "$fulfillment" | jq -r '.id')
      status=$(echo "$fulfillment" | jq -r '.status')
      created_at=$(echo "$fulfillment" | jq -r '.created_at')
      
      # Get line items
      line_items=$(echo "$fulfillment" | jq -c '.line_items')
      
      # Insert into fulfillments table
      curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments" \
        -H "apikey: $KEY" \
        -H "Authorization: Bearer $KEY" \
        -H "Content-Type: application/json" \
        -H "Prefer: resolution=merge-duplicates" \
        -d "{
          \"shop\": \"$shop\",
          \"order_id\": \"$order_id\",
          \"fulfillment_id\": \"$fulfillment_id\",
          \"status\": \"$status\",
          \"date\": \"$created_at\",
          \"line_items\": $line_items
        }" > /dev/null
    done
    
    ((success++))
    echo "   ✅ Success ($fulfillment_count fulfillments)"
  else
    ((failed++))
    echo "   ⚠️  No fulfillments found"
  fi
  
  # Rate limiting
  sleep 0.5
done

echo ""
echo "✅ Direct sync complete!"
echo "   Success: $success orders"
echo "   Failed: $failed orders"
echo ""
echo "📊 Verify:"
echo "SELECT COUNT(DISTINCT order_id) FROM fulfillments WHERE order_id IN ('7845068210510','7868241314126','7802698105166');"
