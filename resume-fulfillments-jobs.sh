#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "▶️  Resuming paused fulfillments jobs..."
echo ""

# Find jobs that were paused
paused_count=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.fulfillments&status=eq.failed&error_message=like.*PAUSED*&select=id" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '. | length')

echo "Found $paused_count paused jobs"

# Resume them by changing status back to pending
curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.fulfillments&status=eq.failed&error_message=like.*PAUSED*" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"pending","error_message":null,"started_at":null}'

echo "✅ Resumed $paused_count jobs"
echo ""

# Show current status
echo "📊 Current status:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.fulfillments&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "ℹ️  Jobs will be processed automatically by cron (every 5 min)"
echo "   Or run ./finish-fulfillments-sync.sh to process now"
