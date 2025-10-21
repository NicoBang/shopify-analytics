#!/bin/bash

echo "🔄 Starting backfill of fulfillments refund data..."

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-fulfillments-refunds" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" | jq .

echo ""
echo "✅ Backfill complete"
