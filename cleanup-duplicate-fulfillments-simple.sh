#!/bin/bash

# cleanup-duplicate-fulfillments-simple.sh
# Simple approach: Get ALL fulfillments, find duplicates in bash, cleanup

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧹 Finding and cleaning duplicate fulfillment rows..."
echo ""
echo "Step 1: Fetching ALL fulfillments (this may take a minute)..."

# Fetch ALL fulfillments with pagination
all_fulfillments="[]"
offset=0
limit=1000

while true; do
  echo "  Fetching batch at offset $offset..."

  batch=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?select=id,shop,order_id,created_at&order=created_at.asc&limit=$limit&offset=$offset" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY")

  batch_count=$(echo "$batch" | jq '. | length')

  if [ "$batch_count" -eq 0 ]; then
    break
  fi

  all_fulfillments=$(echo "$all_fulfillments" "$batch" | jq -s 'add')
  offset=$((offset + limit))
done

total_count=$(echo "$all_fulfillments" | jq '. | length')
echo "  ✅ Fetched $total_count total fulfillment rows"
echo ""

echo "Step 2: Identifying duplicates..."

# Find duplicates by grouping on shop+order_id
duplicates=$(echo "$all_fulfillments" | jq -r '
  group_by(.shop + "|" + .order_id) |
  map(select(length > 1)) |
  map({
    shop: .[0].shop,
    order_id: .[0].order_id,
    rows: .,
    row_count: length
  }) |
  .[]
')

duplicate_count=$(echo "$duplicates" | jq -s '. | length')

if [ "$duplicate_count" -eq 0 ]; then
  echo "✅ No duplicates found!"
  exit 0
fi

echo "  Found $duplicate_count orders with duplicates"
echo ""

echo "Step 3: Cleaning up duplicates..."
echo ""

total_deleted=0
processed=0

echo "$duplicates" | jq -c '.' | while read -r duplicate; do
  shop=$(echo "$duplicate" | jq -r '.shop')
  order_id=$(echo "$duplicate" | jq -r '.order_id')
  row_count=$(echo "$duplicate" | jq -r '.row_count')
  rows=$(echo "$duplicate" | jq -c '.rows')

  processed=$((processed + 1))
  echo "[$processed/$duplicate_count] Order $order_id ($shop): $row_count rows"

  # Get full data for all rows
  full_rows=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?shop=eq.$shop&order_id=eq.$order_id&select=*&order=created_at.asc" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY")

  # Keep row with HIGHEST refunded_qty (if tie, keep newest by created_at)
  # First sort by refunded_qty DESC, then by created_at DESC for tie-breaking
  keep_id=$(echo "$full_rows" | jq -r '
    map({
      id: .id,
      refunded_qty: (.refunded_qty // 0),
      created_at: .created_at
    }) |
    sort_by(-.refunded_qty, -.created_at) |
    .[0].id
  ')

  # Merge data from all rows (take best values)
  merged_refunded_qty=$(echo "$full_rows" | jq -r '[.[] | select(.refunded_qty != null) | .refunded_qty] | max // null')
  merged_refund_date=$(echo "$full_rows" | jq -r '[.[] | select(.refund_date != null) | .refund_date] | max // null')
  merged_country=$(echo "$full_rows" | jq -r '[.[] | select(.country != null) | .country] | .[-1] // null')  # Take latest non-null
  merged_tracking=$(echo "$full_rows" | jq -r '[.[] | select(.tracking_company != null) | .tracking_company] | .[-1] // null')  # Take latest non-null

  # Update kept row
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

  curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?id=eq.$keep_id" \
    -H "apikey: $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$update_payload" >/dev/null 2>&1

  # Delete all OTHER rows (not the one we're keeping)
  deleted_this_order=0
  echo "$full_rows" | jq -r --arg keep_id "$keep_id" '.[] | select(.id != $keep_id) | .id' | while read -r delete_id; do
    curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?id=eq.$delete_id" \
      -H "apikey: $KEY" \
      -H "Prefer: return=minimal" >/dev/null 2>&1
    deleted_this_order=$((deleted_this_order + 1))
  done

  deleted_count=$((row_count - 1))
  kept_refunded=$(echo "$full_rows" | jq -r --arg keep_id "$keep_id" '.[] | select(.id == $keep_id) | .refunded_qty // 0')
  echo "  ✅ Kept row with refunded_qty=$kept_refunded (merged to $merged_refunded_qty), deleted $deleted_count duplicates"
  echo ""

  total_deleted=$((total_deleted + deleted_count))
done

echo ""
echo "✅ Cleanup complete!"
echo "   Processed: $duplicate_count orders"
echo "   Deleted: $total_deleted duplicate rows"
echo ""
echo "Verify no duplicates remain:"
echo "  SELECT COUNT(*) FROM (SELECT order_id FROM fulfillments GROUP BY order_id HAVING COUNT(*) > 1) sub;"
