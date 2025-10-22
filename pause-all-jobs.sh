#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "⏸️  Pausing ALL pending sync jobs..."
echo ""

# Show current status first
echo "📊 Before pause:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.pending&select=object_type" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.object_type) | map({type: .[0].object_type, count: length})'

echo ""

# Pause all pending jobs (all types)
curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.pending" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"failed","error_message":"PAUSED - resume with resume-all-jobs.sh"}'

echo "✅ Paused all pending jobs"
echo ""

# Show status after pause
echo "📊 After pause:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?select=status,object_type" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "ℹ️  All pending jobs marked as 'failed' with error message 'PAUSED'"
echo "   Run ./resume-all-jobs.sh to resume them"
