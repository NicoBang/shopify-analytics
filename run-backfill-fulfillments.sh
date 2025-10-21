#!/bin/bash

# Backfill Fulfillments Script - Using Orchestrator Pattern
# Creates jobs in bulk_sync_jobs table that will be processed by continue-orchestrator
# Much faster and more reliable than direct API calls

if [ "$#" -ne 2 ]; then
  echo "Usage: ./run-backfill-fulfillments.sh START_DATE END_DATE"
  echo "Example: ./run-backfill-fulfillments.sh 2024-09-30 2025-10-21"
  exit 1
fi

START_DATE="$1"
END_DATE="$2"

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🚚 Creating fulfillment sync jobs for $START_DATE to $END_DATE"
echo ""

# Step 1: Create jobs using orchestrator
echo "📅 Creating jobs..."
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"startDate\": \"$START_DATE\",
    \"endDate\": \"$END_DATE\",
    \"types\": [\"fulfillments\"]
  }" | jq '.'

echo ""
echo "✅ Jobs created! Processing will happen automatically via continue-orchestrator (runs every 5 min)"
echo ""
echo "💡 Monitor progress:"
echo "   ./check-sync-status.sh $START_DATE $END_DATE"
echo ""
echo "🔄 Manual trigger (optional):"
echo "   curl -X POST 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator' \\"
echo "     -H 'Authorization: Bearer $KEY' -d '{}'"
