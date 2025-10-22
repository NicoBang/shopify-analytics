#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "⏸️  Pausing fulfillments jobs..."
echo ""

# Mark all pending fulfillments jobs as 'paused' (custom status)
curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.fulfillments&status=eq.pending" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"failed","error_message":"PAUSED - resume with resume-fulfillments-jobs.sh"}'

echo "✅ Paused all pending fulfillments jobs"
echo ""

# Show current status
echo "📊 Current status:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.fulfillments&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "ℹ️  Jobs marked as 'failed' with error message 'PAUSED'"
echo "   Run ./resume-fulfillments-jobs.sh to resume them"
