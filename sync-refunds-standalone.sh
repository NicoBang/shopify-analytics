#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

# Default to full historical period if no args provided
START_DATE="${1:-2024-08-09}"
END_DATE="${2:-2025-10-22}"

echo "🔄 Syncing refunds STANDALONE (no dependencies)"
echo "📅 Period: $START_DATE to $END_DATE"
echo ""

# All 5 shops
SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

total_shops=${#SHOPS[@]}
current_shop=0

for shop in "${SHOPS[@]}"; do
  ((current_shop++))
  echo "[$current_shop/$total_shops] 🏪 $shop"

  # Call bulk-sync-refunds directly (bypasses orchestrator/dependencies)
  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"shop\": \"$shop\",
      \"startDate\": \"$START_DATE\",
      \"endDate\": \"$END_DATE\"
    }" \
    --max-time 300)

  # Check response
  if echo "$response" | grep -q "success\|completed"; then
    echo "   ✅ Success"
  elif echo "$response" | grep -q "error\|Error"; then
    echo "   ❌ Error: $response"
  else
    echo "   ⚠️  Response: $response"
  fi

  echo ""
  
  # Small delay between shops
  sleep 2
done

echo "✅ Refunds sync complete for all shops!"
echo ""
echo "📊 Check results:"
echo "SELECT shop, COUNT(*) as refunded_skus, SUM(refunded_amount_dkk) as total_refunds"
echo "FROM skus"
echo "WHERE refunded_qty > 0"
echo "  AND created_at_original >= '$START_DATE'"
echo "  AND created_at_original <= '$END_DATE'"
echo "GROUP BY shop;"
