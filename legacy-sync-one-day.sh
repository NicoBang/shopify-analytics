#!/bin/bash

# Legacy Sync for One Day (Historical Backfill)
# Purpose: Sync refunds for orders created on a specific date
# Uses: order.created_at (not refund.created_at)

SHOP="pompdelux-da.myshopify.com"
DATE="2025-08-07"
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🕰️  Legacy refunds sync for $DATE on $SHOP"
echo "   Using order.created_at (historical backfill)"
echo ""

# Get order count for the date
ORDER_COUNT=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/orders?shop=eq.$SHOP&created_at=gte.${DATE}T00:00:00Z&created_at=lte.${DATE}T23:59:59Z&select=order_id" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'length')

echo "📊 Found $ORDER_COUNT orders created on $DATE"
echo ""

if [ "$ORDER_COUNT" -eq 0 ]; then
  echo "✅ No orders to process"
  exit 0
fi

# Calculate number of batches needed (50 orders per batch = ~30 seconds)
BATCH_SIZE=50
NUM_BATCHES=$(( (ORDER_COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "📦 Splitting into $NUM_BATCHES batches of $BATCH_SIZE orders each"
echo ""

# Get all order IDs
ORDER_IDS=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/orders?shop=eq.$SHOP&created_at=gte.${DATE}T00:00:00Z&created_at=lte.${DATE}T23:59:59Z&select=order_id&order=created_at.asc" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq -r '.[].order_id')

# Convert to array
IFS=$'\n' read -rd '' -a ORDER_ARRAY <<< "$ORDER_IDS"

TOTAL_PROCESSED=0
TOTAL_ERRORS=0

# Process in batches
for ((batch=0; batch<NUM_BATCHES; batch++)); do
  start=$((batch * BATCH_SIZE))
  end=$((start + BATCH_SIZE))

  if [ $end -gt $ORDER_COUNT ]; then
    end=$ORDER_COUNT
  fi

  batch_orders=("${ORDER_ARRAY[@]:$start:$BATCH_SIZE}")
  batch_count=${#batch_orders[@]}

  echo "🔄 Batch $((batch + 1))/$NUM_BATCHES: Processing orders $start-$((end - 1)) ($batch_count orders)..."

  # Process each order in this batch
  processed=0
  errors=0

  for order_id in "${batch_orders[@]}"; do
    # Fetch refunds for this order
    refunds=$(curl -s "https://$SHOP/admin/api/2024-10/orders/$order_id/refunds.json" \
      -H "X-Shopify-Access-Token: $SHOPIFY_TOKEN_DA" \
      -H "Content-Type: application/json")

    refund_count=$(echo "$refunds" | jq '.refunds | length')

    if [ "$refund_count" -gt 0 ]; then
      echo "  ✓ Order $order_id has $refund_count refund(s)"
      # TODO: Update database here
      ((processed++))
    fi

    # Rate limiting
    sleep 0.5
  done

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + processed))

  echo "  ✅ Batch complete: $processed orders with refunds"
  echo ""

  # Small delay between batches
  sleep 2
done

echo "✅ All batches complete!"
echo "   Total orders processed: $TOTAL_PROCESSED"
echo "   Total errors: $TOTAL_ERRORS"
