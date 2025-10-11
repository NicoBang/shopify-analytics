#!/bin/bash

# Test specific problematic fields

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "Testing billingAddress without customer..."

# Test just billingAddress (without customer)
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/test-direct-bulk" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-10",
    "endDate": "2025-10-10"
  }' > /tmp/test_result.json

# Modify the test-direct-bulk to test billingAddress without customer
# But since we can't easily modify it, let's update bulk-sync-orders to remove problematic fields