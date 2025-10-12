#!/bin/bash

# Sync Product Metadata Script with Pagination
# Handles large product catalogs by fetching in chunks

VERCEL_TOKEN="bda5da3d49fe0e7391fded3895b5c6bc"
VERCEL_API="https://shopify-analytics-nu.vercel.app"
BATCH_SIZE=500  # Fetch 500 products per API call

sync_metadata() {
  local shop=$1
  local type=$2
  local table=$3

  echo "🔄 Syncing $shop → $table..."

  local cursor=""
  local total=0
  local page=1

  while true; do
    echo "  📦 Page $page..."

    # Build URL with cursor if available
    local url="$VERCEL_API/api/sync-shop?shop=$shop&type=$type&maxProducts=$BATCH_SIZE"
    if [ -n "$cursor" ]; then
      url="${url}&cursor=${cursor}"
    fi

    # Call API and capture response
    local response=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "$url")

    # Check for errors
    if echo "$response" | grep -q "error"; then
      echo "  ❌ Error: $response"
      break
    fi

    # Extract values using grep and sed
    local synced=$(echo "$response" | grep -o '"recordsSynced":[0-9]*' | grep -o '[0-9]*')

    # For metadata-eur and metadata-chf, hasMore is in data object
    local has_more=$(echo "$response" | grep -o '"hasMore":true' | head -1)
    local next_cursor=$(echo "$response" | grep -o '"nextCursor":"[^"]*"' | sed 's/"nextCursor":"//;s/"$//' | head -1)

    # If synced is empty, might be in data.eurMetadataItems or data.chfMetadataItems
    if [ -z "$synced" ]; then
      synced=$(echo "$response" | grep -o '"eurMetadataItems":[0-9]*' | grep -o '[0-9]*')
    fi
    if [ -z "$synced" ]; then
      synced=$(echo "$response" | grep -o '"chfMetadataItems":[0-9]*' | grep -o '[0-9]*')
    fi
    if [ -z "$synced" ]; then
      synced=0
    fi

    total=$((total + synced))
    echo "  ✅ Fetched $synced products (total: $total)"

    # Check if there's more data
    if [ -z "$has_more" ]; then
      echo "  ✨ Complete! Total products: $total"
      break
    fi

    # Update cursor for next iteration
    cursor="$next_cursor"
    page=$((page + 1))

    # Small delay to avoid rate limiting
    sleep 1
  done

  echo ""
}

echo "📦 Syncing product metadata for all shops with pagination"
echo ""

# DKK shop → product_metadata
sync_metadata "pompdelux-da.myshopify.com" "metadata" "product_metadata"

# EUR shop → product_metadata_eur
sync_metadata "pompdelux-de.myshopify.com" "metadata-eur" "product_metadata_eur"

# CHF shop → product_metadata_chf
sync_metadata "pompdelux-chf.myshopify.com" "metadata-chf" "product_metadata_chf"

echo "✅ All metadata tables synced"
echo "   • product_metadata (DKK)"
echo "   • product_metadata_eur (EUR)"
echo "   • product_metadata_chf (CHF)"
