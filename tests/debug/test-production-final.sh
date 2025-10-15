#!/bin/bash

# Final test of production bulk-sync-orders with all fixes
# This tests the deployed function to verify all issues are resolved

echo "🧪 Final Production Test - bulk-sync-orders"
echo ""
echo "✅ Fixed issues:"
echo "  1. Checks and cancels existing bulk operations"
echo "  2. Handles ACCESS_DENIED errors gracefully"
echo "  3. Adds delay for same-day queries"
echo "  4. Better logging throughout the process"
echo "  5. ONLY processes orders (no SKUs)"
echo "-------------------------------------------"
echo ""

# Load environment variables
set -a
source .env.local
set +a

# Test 1: A date we know has orders (yesterday)
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
echo "📅 Test 1: Yesterday ($YESTERDAY) - Known to have orders"
echo ""

START_TIME=$(date +%s)

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"pompdelux-da.myshopify.com\",
    \"startDate\": \"$YESTERDAY\",
    \"endDate\": \"$YESTERDAY\",
    \"testMode\": true
  }" | jq '.'

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo ""
echo "⏱️ Execution time: ${DURATION} seconds"
echo ""
echo "-------------------------------------------"
echo ""

# Test 2: A historical date range
echo "📅 Test 2: Historical range (2025-10-01 to 2025-10-02)"
echo ""

START_TIME=$(date +%s)

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"pompdelux-da.myshopify.com\",
    \"startDate\": \"2025-10-01\",
    \"endDate\": \"2025-10-02\",
    \"testMode\": true
  }" | jq '.'

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo ""
echo "⏱️ Execution time: ${DURATION} seconds"
echo ""
echo "-------------------------------------------"
echo ""

# Test 3: Run actual sync (not test mode) for a single historical day
echo "📅 Test 3: REAL sync for 2025-10-01 (not test mode)"
echo "⚠️ This will write to the database!"
echo ""

read -p "Press Enter to continue with REAL sync, or Ctrl+C to cancel..."

START_TIME=$(date +%s)

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"pompdelux-da.myshopify.com\",
    \"startDate\": \"2025-10-01\",
    \"endDate\": \"2025-10-01\",
    \"testMode\": false
  }" | jq '.'

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo ""
echo "⏱️ Execution time: ${DURATION} seconds"
echo ""
echo "-------------------------------------------"
echo "✨ All tests completed!"
echo ""
echo "If all tests succeed, the bulk-sync-orders function is:"
echo "  ✅ Handling bulk operations correctly"
echo "  ✅ Processing ONLY orders (not SKUs)"
echo "  ✅ Ready for production use"