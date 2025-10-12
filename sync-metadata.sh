#!/bin/bash

# Sync Product Metadata Script
# Syncs product metadata for all shops to currency-specific tables

VERCEL_TOKEN="bda5da3d49fe0e7391fded3895b5c6bc"
VERCEL_API="https://shopify-analytics-nu.vercel.app"
MAX_PRODUCTS=50000

echo "📦 Syncing product metadata for all shops"
echo ""

# DKK shop → product_metadata (default table)
echo "🇩🇰 Syncing pompdelux-da.myshopify.com → product_metadata..."
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$VERCEL_API/api/sync-shop?shop=pompdelux-da.myshopify.com&type=metadata&maxProducts=$MAX_PRODUCTS" &

# EUR shops → product_metadata_eur (only need one EUR shop, they're identical)
echo "🇪🇺 Syncing pompdelux-de.myshopify.com → product_metadata_eur..."
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$VERCEL_API/api/sync-shop?shop=pompdelux-de.myshopify.com&type=metadata-eur&maxProducts=$MAX_PRODUCTS" &

# CHF shop → product_metadata_chf
echo "🇨🇭 Syncing pompdelux-chf.myshopify.com → product_metadata_chf..."
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$VERCEL_API/api/sync-shop?shop=pompdelux-chf.myshopify.com&type=metadata-chf&maxProducts=$MAX_PRODUCTS" &

wait

echo ""
echo "✅ All metadata tables synced"
echo "   • product_metadata (DKK)"
echo "   • product_metadata_eur (EUR)"
echo "   • product_metadata_chf (CHF)"
