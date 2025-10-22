#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "▶️  Resuming ALL paused sync jobs..."
echo ""

# Find jobs that were paused
echo "📊 Finding paused jobs..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.failed&error_message=like.*PAUSED*&select=object_type" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.object_type) | map({type: .[0].object_type, count: length})'

echo ""

# Resume them by changing status back to pending
curl -s -X PATCH "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.failed&error_message=like.*PAUSED*" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"pending","error_message":null,"started_at":null}'

echo "✅ Resumed all paused jobs"
echo ""

# Show current status
echo "📊 Current status:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?select=status,object_type" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "ℹ️  Jobs will be processed automatically by cron (every 5 min)"
echo "   Or run ./finish-refunds-sync.sh / ./finish-fulfillments-sync.sh to process specific types now"
