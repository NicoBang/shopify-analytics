#!/bin/bash

# Usage: ./sync-date-range.sh 2025-10-01 2025-10-07

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE=${1:-"2025-10-01"}
END_DATE=${2:-"2025-10-07"}

echo "🚀 Starting bulk sync for all shops from $START_DATE to $END_DATE"
echo "   This will sync both orders and SKUs for each date"
echo ""

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"shops\": [
      \"pompdelux-da.myshopify.com\",
      \"pompdelux-de.myshopify.com\",
      \"pompdelux-nl.myshopify.com\",
      \"pompdelux-int.myshopify.com\",
      \"pompdelux-chf.myshopify.com\"
    ],
    \"types\": [\"both\"],
    \"startDate\": \"$START_DATE\",
    \"endDate\": \"$END_DATE\"
  }"

echo ""
echo "✅ Orchestrator started (running in background)"
echo "   Check status with: ./check-sync-status.sh $START_DATE $END_DATE"
