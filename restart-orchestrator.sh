#!/bin/bash

# Start orchestrator to create missing jobs
# It will timeout after 6-7 minutes, but that's OK - it creates pending jobs

echo "🚀 Starting bulk-sync-orchestrator to create missing jobs..."
echo "   This will timeout after ~6 minutes, which is expected."
echo ""

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2025-08-01",
    "endDate": "2025-09-30"
  }'

echo ""
echo "✅ Orchestrator called (may have timed out - this is OK)"
