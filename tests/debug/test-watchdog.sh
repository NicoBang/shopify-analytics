#!/bin/bash

# Test Watchdog Cleanup Function
# This script manually triggers the watchdog to clean up stalled jobs

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🐕 Running watchdog cleanup..."

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/watchdog-cleanup" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

echo ""
echo "✅ Watchdog complete"
