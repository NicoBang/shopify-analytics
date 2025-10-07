#!/bin/bash

# Start orchestrator to create missing jobs
# It will timeout after 6-7 minutes, but that's OK - it creates pending jobs
#
# Usage: ./restart-orchestrator.sh [START_DATE] [END_DATE]
# Example: ./restart-orchestrator.sh 2025-10-01 2025-10-31

START_DATE="${1:-2025-08-01}"
END_DATE="${2:-2025-09-30}"

echo "🚀 Starting bulk-sync-orchestrator to create missing jobs..."
echo "   Period: $START_DATE → $END_DATE"
echo "   This will timeout after ~6 minutes, which is expected."
echo ""

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d "{
    \"startDate\": \"$START_DATE\",
    \"endDate\": \"$END_DATE\"
  }"

echo ""
echo "✅ Orchestrator called (may have timed out - this is OK)"
