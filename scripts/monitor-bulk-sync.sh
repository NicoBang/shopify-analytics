#!/bin/bash

# Monitor bulk sync progress
# Usage: ./scripts/monitor-bulk-sync.sh

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "📊 Checking SKU sync progress..."
echo ""

# Query database for SKUs in September-October 2025
curl -s "${SUPABASE_URL}/rest/v1/rpc/get_sku_summary" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2025-09-01","end_date":"2025-10-31","target_shop":"pompdelux-da.myshopify.com"}' \
  | python3 -m json.tool 2>/dev/null || echo "Database query failed (might still be processing)"

echo ""
echo "✅ Monitoring tip: Run this script every few minutes to track progress"
echo "📝 Full sync expected to take 30-60 minutes for 61 days of data"
