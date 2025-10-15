#!/bin/bash

# Test real sync (non-test mode) for a recent date

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Running real sync (non-test mode) for October 10, 2025..."
echo "This will actually save orders to the database"
echo "==========================================="

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-10",
    "endDate": "2025-10-10",
    "testMode": false
  }' | jq '.'

echo ""
echo "✅ Sync complete! Orders should now be in the database."
echo "Note: Customer email and address fields will be null due to permission limitations."