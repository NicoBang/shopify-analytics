#!/bin/bash
# Fix duplicates and continue sync properly

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🔧 FIXING DUPLICATES AND CONTINUING SYNC"
echo "========================================"
echo ""

# Step 1: Clean up duplicate stuck jobs
echo "📋 Cleaning up stuck/duplicate jobs..."

# Mark stuck running jobs as failed
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.running" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "failed", "error_message": "Stuck job - marked as failed for retry"}' > /dev/null

echo "✓ Stuck jobs marked as failed"

# Delete duplicates keeping only one per shop/date combo
echo "📋 Removing duplicate jobs..."
cat << 'EOF' | psql $DATABASE_URL 2>/dev/null || echo "Could not remove duplicates via psql"
DELETE FROM bulk_sync_jobs a
USING bulk_sync_jobs b
WHERE a.id > b.id
  AND a.shop = b.shop
  AND a.start_date = b.start_date
  AND a.object_type = b.object_type
  AND a.object_type = 'skus';
EOF

# Reset all failed SKU jobs to pending
echo "📋 Resetting failed jobs to pending..."
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed&start_date=gte.2024-09-30&start_date=lte.2025-10-09" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending", "error_message": null, "started_at": null, "completed_at": null}' > /dev/null

echo "✓ Failed jobs reset to pending"
echo ""

# Step 2: Check current status
echo "📊 Current status:"
response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY")

pending=$(echo "$response" | jq '[.[] | select(.status == "pending")] | length')
completed=$(echo "$response" | jq '[.[] | select(.status == "completed")] | length')
failed=$(echo "$response" | jq '[.[] | select(.status == "failed")] | length')

echo "   Pending: $pending"
echo "   Completed: $completed"
echo "   Failed: $failed"
echo ""

# Step 3: Continue processing
echo "📋 Processing pending jobs..."
echo "   This will take 15-30 minutes for full sync"
echo ""

MAX_ITERATIONS=150
ITERATION=0

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))

  # Call continue-orchestrator
  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}')

  # Parse response
  complete=$(echo "$response" | jq -r '.complete // false')
  batch_processed=$(echo "$response" | jq -r '.batch.processed // 0')
  batch_successful=$(echo "$response" | jq -r '.batch.successful // 0')
  stats_pending=$(echo "$response" | jq -r '.stats.pending // 0')
  stats_completed=$(echo "$response" | jq -r '.stats.completed // 0')

  # Show progress
  echo "   Batch $ITERATION: Processed $batch_processed jobs ($batch_successful successful)"
  echo "      Overall: $stats_pending pending, $stats_completed completed"

  # Check if done
  if [ "$complete" = "true" ] || [ "$stats_pending" = "0" ]; then
    echo ""
    echo "✅ ALL JOBS COMPLETED!"
    break
  fi

  # Don't spam - wait between batches
  sleep 5
done

echo ""
echo "📊 FINAL STATUS CHECK"
echo "===================="
echo ""

# Get final coverage
cat << 'EOF' > /tmp/final_coverage.sql
SELECT
  shop,
  COUNT(DISTINCT DATE(created_at_original)) || '/375' as coverage,
  ROUND(100.0 * COUNT(DISTINCT DATE(created_at_original)) / 375, 1) || '%' as percent,
  COUNT(*) as total_skus,
  MIN(DATE(created_at_original))::text as first_date,
  MAX(DATE(created_at_original))::text as last_date
FROM skus
WHERE created_at_original >= '2024-09-30'
  AND created_at_original < '2025-10-10'
GROUP BY shop
ORDER BY shop;
EOF

echo "Run this SQL to verify coverage:"
echo "--------------------------------"
cat /tmp/final_coverage.sql

echo ""
echo "✅ Sync script complete!"
echo ""
echo "If coverage is not 100%, run this script again."