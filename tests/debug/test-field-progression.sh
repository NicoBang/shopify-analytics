#!/bin/bash

# Test progressive field additions to identify which cause ACCESS_DENIED

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "Testing progressive field additions..."
echo "=================================="

for level in 1 2 3 4 5 6 7; do
    echo ""
    echo "Test Level $level:"
    echo "-----------------"

    curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/test-progressive-fields" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"shop\": \"pompdelux-da.myshopify.com\",
        \"startDate\": \"2025-10-10\",
        \"endDate\": \"2025-10-10\",
        \"testLevel\": $level
      }" | jq '.'

    # Wait a bit between tests to avoid rate limiting
    sleep 2
done

echo ""
echo "=================================="
echo "Test complete!"