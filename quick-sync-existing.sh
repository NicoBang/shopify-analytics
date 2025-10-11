#!/bin/bash
# Quick sync using EXISTING Edge Functions
# No deployment needed!

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🚀 QUICK SKU SYNC - Using existing functions"
echo "============================================"
echo ""

# Step 1: Reset failed jobs
echo "📋 Step 1: Resetting failed jobs..."
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}' > /dev/null
echo "✓ Done"

# Step 2: Create missing jobs for the period
echo "📋 Step 2: Creating jobs for missing data..."
for i in {1..5}; do
  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/create-missing-jobs" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "startDate": "2024-09-30",
      "endDate": "2025-10-09",
      "objectType": "skus"
    }')

  remaining=$(echo "$response" | jq -r '.stats.remaining // 0')
  created=$(echo "$response" | jq -r '.stats.created // 0')

  echo "   Created $created jobs, $remaining remaining"

  if [ "$remaining" = "0" ]; then
    break
  fi
  sleep 2
done

# Step 3: Process all pending jobs
echo ""
echo "📋 Step 3: Processing pending jobs..."
echo "   This will take 15-30 minutes..."
echo ""

for i in {1..100}; do
  echo -n "   Batch $i: "

  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}')

  complete=$(echo "$response" | jq -r '.complete // false')
  pending=$(echo "$response" | jq -r '.stats.pending // 0')
  completed=$(echo "$response" | jq -r '.stats.completed // 0')
  failed=$(echo "$response" | jq -r '.stats.failed // 0')

  echo "Pending: $pending, Completed: $completed, Failed: $failed"

  if [ "$complete" = "true" ] || [ "$pending" = "0" ]; then
    echo ""
    echo "✅ ALL DONE!"
    break
  fi

  sleep 5
done

echo ""
echo "📊 Final check..."
curl -s -X POST "$SUPABASE_URL/functions/v1/sku-sync-status" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq '.summary'

echo ""
echo "✅ Sync complete!"