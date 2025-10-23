#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

KEY="${SUPABASE_SERVICE_ROLE_KEY}"

echo "🧪 Testing backfill-refund-amounts Edge Function"
echo ""
echo "⚠️ This will run in DRY RUN mode - no changes will be made"
echo ""

# Test with a small date range first (September 2025)
echo "📅 Testing with September 2025 data..."
echo ""

response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-refund-amounts" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2025-09-01",
    "endDate": "2025-09-30",
    "dryRun": true
  }')

echo "$response" | jq

echo ""
echo "✅ Dry run complete. Review the output above."
echo ""
echo "If everything looks correct, you can run for real by setting dryRun: false"
