#!/bin/bash

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Syncing refunds for October 2025 manually..."
echo ""
echo "Step 1: Creating refunds jobs via orchestrator..."

# Create jobs using orchestrator
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2025-10-01","endDate":"2025-10-22","objectType":"refunds"}' \
  --max-time 30 > /dev/null 2>&1

echo "   ✅ Jobs created (may already exist - OK)"
echo ""

echo "Step 2: Processing refunds jobs (ignoring dependencies)..."
echo ""

# Get all pending refunds jobs for October
JOBS=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&status=eq.pending&start_date=gte.2025-10-01&start_date=lte.2025-10-22&select=id,shop,start_date" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY")

# Count jobs
JOB_COUNT=$(echo "$JOBS" | jq '. | length')

if [ "$JOB_COUNT" = "0" ]; then
  echo "✅ No pending refunds jobs - all already completed!"
  exit 0
fi

echo "Found $JOB_COUNT pending jobs to process"
echo ""

# Process each job directly
counter=0
echo "$JOBS" | jq -c '.[]' | while read -r job; do
  ((counter++))
  
  JOB_ID=$(echo "$job" | jq -r '.id')
  SHOP=$(echo "$job" | jq -r '.shop')
  START_DATE=$(echo "$job" | jq -r '.start_date')
  
  pct=$((counter * 100 / JOB_COUNT))
  echo "[$counter/$JOB_COUNT - $pct%] Processing $SHOP ($START_DATE)..."
  
  # Call bulk-sync-refunds directly with jobId
  response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"shop\":\"$SHOP\",\"startDate\":\"$START_DATE\",\"endDate\":\"$START_DATE\",\"jobId\":\"$JOB_ID\"}" \
    --max-time 60)
  
  if echo "$response" | grep -q "success"; then
    echo "   ✅ Success"
  elif echo "$response" | grep -q "already running"; then
    echo "   ⏸️  Skipped (already running)"
  else
    echo "   ⚠️  $response"
  fi
  
  # Small delay
  sleep 0.5
done

echo ""
echo "✅ Refunds sync complete!"
echo ""
echo "📊 Check results:"
echo "SELECT status, COUNT(*) FROM bulk_sync_jobs WHERE object_type='refunds' AND start_date>='2025-10-01' AND start_date<='2025-10-22' GROUP BY status;"
