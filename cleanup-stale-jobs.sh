#!/bin/bash

# Cleanup stale running jobs that were killed by Supabase timeout

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔍 Finding stale running jobs (running > 2 minutes)..."

# Calculate timestamp 2 minutes ago
TWO_MIN_AGO=$(date -u -v-2M +"%Y-%m-%dT%H:%M:%S")

curl -s -X PATCH \
  "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?status=eq.running&started_at=lt.${TWO_MIN_AGO}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "status": "failed",
    "error_message": "Edge Function timeout - job killed by Supabase after ~2 minutes",
    "completed_at": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
  }' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'✅ Cleaned up {len(data)} stale jobs')"

echo ""
echo "📊 Current status summary (last 24 hours):"
YESTERDAY=$(date -u -v-1d +"%Y-%m-%dT%H:%M:%S")
curl -s -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?created_at=gte.${YESTERDAY}&select=status" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); counts={}
for item in data:
    status = item['status']
    counts[status] = counts.get(status, 0) + 1
for status in sorted(counts.keys()):
    print(f'{status}: {counts[status]}')"
