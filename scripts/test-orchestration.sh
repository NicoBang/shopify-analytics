#!/bin/bash
# Test script for bulk-sync-skus orchestration with refunds
#
# Usage:
#   1. Get your service_role key from: https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/settings/api
#   2. Run: SUPABASE_SERVICE_ROLE_KEY="your_key_here" ./scripts/test-orchestration.sh

set -e

# Check if service role key is provided
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required"
  echo ""
  echo "Get it from: https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/settings/api"
  echo ""
  echo "Usage:"
  echo "  SUPABASE_SERVICE_ROLE_KEY=\"your_key_here\" ./scripts/test-orchestration.sh"
  exit 1
fi

SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/bulk-sync-skus"

# Default test parameters (can be overridden via environment variables)
SHOP="${TEST_SHOP:-pompdelux-da.myshopify.com}"
START_DATE="${TEST_START_DATE:-2024-09-27}"
END_DATE="${TEST_END_DATE:-2024-09-27}"
INCLUDE_REFUNDS="${TEST_INCLUDE_REFUNDS:-true}"

echo "🚀 Testing bulk-sync-skus orchestration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Shop:            $SHOP"
echo "Date Range:      $START_DATE → $END_DATE"
echo "Include Refunds: $INCLUDE_REFUNDS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Make the request
echo "📡 Sending request..."
RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"shop\": \"$SHOP\",
    \"startDate\": \"$START_DATE\",
    \"endDate\": \"$END_DATE\",
    \"objectType\": \"skus\",
    \"includeRefunds\": $INCLUDE_REFUNDS
  }")

# Check if response is valid JSON
if ! echo "$RESPONSE" | jq . > /dev/null 2>&1; then
  echo "❌ Invalid JSON response:"
  echo "$RESPONSE"
  exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.error // .code // empty')
if [ -n "$ERROR" ]; then
  echo "❌ Request failed:"
  echo "$RESPONSE" | jq .
  exit 1
fi

# Display results
echo "✅ Request successful!"
echo ""
echo "📊 Results:"
echo "$RESPONSE" | jq '
  {
    success: .success,
    skuSync: {
      success: .skuSync.success,
      resultsCount: (.skuSync.results | length)
    },
    refundSync: (
      if .refundSync then {
        refundsProcessed: .refundSync.refundsProcessed,
        skusUpdated: .refundSync.skusUpdated
      } else "Not included" end
    )
  }
'

echo ""
echo "🔍 Full response saved to: /tmp/orchestration-test-response.json"
echo "$RESPONSE" | jq . > /tmp/orchestration-test-response.json

echo ""
echo "✅ Test complete!"
