#!/bin/bash

# Test script for fixing historical discount data
# Run with: ./test-fix-discounts.sh

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧪 Testing fix-historical-discounts function..."
echo ""

# Test 1: Dry run on DA shop
echo "Test 1: Dry run on pompdelux-da.myshopify.com"
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/fix-historical-discounts" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-da.myshopify.com","dryRun":true}' | jq '.'

echo ""
echo "✅ Done"
