#!/bin/bash

# cleanup-duplicate-fulfillments-v2.sh
# Uses SQL to efficiently find and cleanup all duplicates in batches

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧹 Finding duplicate fulfillment rows using SQL..."
echo ""

# Count total duplicates first
total_sql="
SELECT COUNT(DISTINCT order_id) as duplicate_count
FROM (
  SELECT order_id
  FROM fulfillments
  GROUP BY order_id
  HAVING COUNT(*) > 1
) sub;
"

total_duplicates=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/rpc/execute_sql" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$total_sql" | jq -Rs .)}" | jq -r '.[0].duplicate_count // 0')

echo "Found $total_duplicates orders with duplicate fulfillments"
echo ""

if [ "$total_duplicates" -eq 0 ]; then
  echo "✅ No duplicates found!"
  exit 0
fi

# Process in batches of 100
batch_size=100
total_processed=0
total_deleted=0

while [ $total_processed -lt $total_duplicates ]; do
  echo "📊 Processing batch: $total_processed - $((total_processed + batch_size)) of $total_duplicates"

  # Get batch of duplicate order_ids
  batch_sql="
  SELECT shop, order_id
  FROM (
    SELECT shop, order_id, COUNT(*) as row_count
    FROM fulfillments
    GROUP BY shop, order_id
    HAVING COUNT(*) > 1
  ) sub
  ORDER BY order_id
  LIMIT $batch_size
  OFFSET $total_processed;
  "

  batch=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/rpc/execute_sql" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$batch_sql" | jq -Rs .)}")

  batch_count=$(echo "$batch" | jq '. | length')

  if [ "$batch_count" -eq 0 ]; then
    echo "✅ No more duplicates to process"
    break
  fi

  # Process each order in batch
  echo "$batch" | jq -c '.[]' | while read -r item; do
    shop=$(echo "$item" | jq -r '.shop')
    order_id=$(echo "$item" | jq -r '.order_id')

    # Get all rows for this order
    rows=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?shop=eq.$shop&order_id=eq.$order_id&select=*&order=created_at.asc" \
      -H "apikey: $KEY" \
      -H "Authorization: Bearer $KEY")

    row_count=$(echo "$rows" | jq '. | length')

    # Keep first row (oldest) as base
    oldest_id=$(echo "$rows" | jq -r '.[0].id')

    # Merge data from all rows
    merged_refunded_qty=$(echo "$rows" | jq -r '[.[] | select(.refunded_qty != null) | .refunded_qty] | max // null')
    merged_refund_date=$(echo "$rows" | jq -r '[.[] | select(.refund_date != null) | .refund_date] | max // null')
    merged_country=$(echo "$rows" | jq -r '[.[] | select(.country != null) | .country] | .[0] // null')
    merged_tracking=$(echo "$rows" | jq -r '[.[] | select(.tracking_company != null) | .tracking_company] | .[0] // null')

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
    echo "$rows" | jq -r '.[1:] | .[] | .id' | while read -r delete_id; do
      curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/fulfillments?id=eq.$delete_id" \
        -H "apikey: $KEY" \
        -H "Prefer: return=minimal" >/dev/null 2>&1
    done

    deleted_count=$((row_count - 1))
    echo "  ✅ Order $order_id: kept 1, deleted $deleted_count rows"
  done

  total_processed=$((total_processed + batch_count))

  # Small delay between batches to avoid rate limiting
  sleep 1
done

echo ""
echo "✅ Cleanup complete! Processed $total_processed orders"
echo ""
echo "Verify with:"
echo "  SELECT COUNT(*) FROM (SELECT order_id FROM fulfillments GROUP BY order_id HAVING COUNT(*) > 1) sub;"
