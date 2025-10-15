#!/bin/bash

# Test production bulk-sync-orders with fixes
# This tests the deployed function to verify it handles recent dates properly

echo "🧪 Testing production bulk-sync-orders with timeout fixes"
echo ""
echo "Improvements deployed:"
echo "✅ Cancels existing bulk operations before starting"
echo "✅ Adds delay for same-day queries"
echo "✅ Better error handling and logging"
echo "✅ ONLY handles orders (no SKUs)"
echo "-------------------------------------------"
echo ""

# Load environment variables
set -a
source .env.local
set +a

# Test with today's date (previously failing)
TODAY=$(date +%Y-%m-%d)
echo "📅 Test 1: Today's date ($TODAY) - Previously failing"

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"pompdelux-da.myshopify.com\",
    \"startDate\": \"$TODAY\",
    \"endDate\": \"$TODAY\",
    \"testMode\": true
  }" | jq '.'

echo ""
echo "-------------------------------------------"
echo ""

# Test with yesterday's date
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
echo "📅 Test 2: Yesterday's date ($YESTERDAY)"

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"pompdelux-da.myshopify.com\",
    \"startDate\": \"$YESTERDAY\",
    \"endDate\": \"$YESTERDAY\",
    \"testMode\": true
  }" | jq '.'

echo ""
echo "-------------------------------------------"
echo "✨ Test completed"
echo ""
echo "If both tests succeed, the timeout issue is fixed!"
echo "The function should now:"
echo "  • Handle concurrent bulk operations"
echo "  • Work with same-day queries"
echo "  • Provide better error messages"
echo "  • Process ONLY orders (not SKUs)"