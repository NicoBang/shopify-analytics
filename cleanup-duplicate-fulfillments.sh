#!/bin/bash

# cleanup-duplicate-fulfillments.sh
# Deletes duplicate fulfillment rows, keeping only the OLDEST row per order_id
# Problem: sync-fulfillments-for-date.sh and bulk-sync-fulfillments create duplicate rows
# Solution: Keep oldest row (earliest created_at), delete newer duplicates

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧹 Finding duplicate fulfillment rows..."
echo ""

# Find orders with multiple fulfillment rows using direct query
# Note: Using limit=1000 to get first batch, script can be run multiple times
duplicates=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?select=shop,order_id&limit=10000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | \
  jq -r 'group_by(.shop + "|" + .order_id) | map(select(length > 1) | {shop: .[0].shop, order_id: .[0].order_id, row_count: length}) | .[]')

duplicate_count=$(echo "$duplicates" | jq -s '. | length')

if [ "$duplicate_count" -eq 0 ]; then
  echo "✅ No duplicates found!"
  exit 0
fi

echo "Found $duplicate_count orders with duplicate fulfillments"
echo ""

total_deleted=0

# For each order with duplicates, keep oldest and delete newer rows
echo "$duplicates" | jq -c '.' | while read -r row; do
  shop=$(echo "$row" | jq -r '.shop')
  order_id=$(echo "$row" | jq -r '.order_id')
  row_count=$(echo "$row" | jq -r '.row_count')

  echo "📦 Order $order_id ($shop): $row_count rows"

  # Get all rows for this order with ALL fields, sorted by created_at
  rows=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?shop=eq.$shop&order_id=eq.$order_id&select=*&order=created_at.asc" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY")

  # Keep first row (oldest) as base
  oldest_id=$(echo "$rows" | jq -r '.[0].id')
  oldest_created=$(echo "$rows" | jq -r '.[0].created_at')

  # Merge data from all rows - take non-null values with priority to latest refund data
  merged_refunded_qty=$(echo "$rows" | jq -r '[.[] | select(.refunded_qty != null) | .refunded_qty] | max // null')
  merged_refund_date=$(echo "$rows" | jq -r '[.[] | select(.refund_date != null) | .refund_date] | max // null')
  merged_country=$(echo "$rows" | jq -r '[.[] | select(.country != null) | .country] | .[0] // null')
  merged_tracking=$(echo "$rows" | jq -r '[.[] | select(.tracking_company != null) | .tracking_company] | .[0] // null')

  echo "  ✅ Keeping oldest: $oldest_id (created: $oldest_created)"
  echo "     Merged data:"
  echo "       - refunded_qty: $merged_refunded_qty"
  echo "       - refund_date: $merged_refund_date"
  echo "       - country: $merged_country"
  echo "       - tracking_company: $merged_tracking"

  # Update oldest row with merged data
  update_payload=$(jq -n \
    --argjson refunded_qty "${merged_refunded_qty:-null}" \
    --arg refund_date "${merged_refund_date}" \
    --arg country "${merged_country}" \
    --arg tracking_company "${merged_tracking}" \
    '{
      refunded_qty: $refunded_qty,
      refund_date: (if $refund_date == "null" then null else $refund_date end),
      country: (if $country == "null" then null else $country end),
      tracking_company: (if $tracking_company == "null" then null else $tracking_company end)
    }')

  curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?id=eq.$oldest_id" \
    -H "apikey: $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$update_payload" >/dev/null 2>&1

  # Delete all other rows
  delete_count=0
  echo "$rows" | jq -r '.[1:] | .[] | .id' | while read -r delete_id; do
    curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?id=eq.$delete_id" \
      -H "apikey: $KEY" \
      -H "Prefer: return=minimal" >/dev/null 2>&1

    echo "  ❌ Deleted duplicate: $delete_id"
    ((delete_count++))
    ((total_deleted++))
  done

  echo ""
done

echo "✅ Cleanup complete! Deleted $total_deleted duplicate rows"
echo ""
echo "Verify with:"
echo "  SELECT order_id, COUNT(*) as row_count FROM fulfillments GROUP BY order_id HAVING COUNT(*) > 1;"
