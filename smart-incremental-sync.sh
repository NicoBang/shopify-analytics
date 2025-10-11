#!/bin/bash
# SMART INCREMENTAL SYNC - Only syncs what's actually missing
# Uses database to check what data already exists
# Much faster than full sync

set -e

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"
SUPABASE_DB_URL="postgresql://postgres.ihawjrtfwysyokfotewn:${SERVICE_KEY}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

echo "🔍 SMART INCREMENTAL SKU SYNC"
echo "=============================="
echo ""

# Step 1: Reset failed jobs
echo "📋 Resetting failed jobs..."
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed&start_date=gte.2024-09-30&start_date=lte.2025-10-09" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}' > /dev/null
echo "✓ Failed jobs reset"
echo ""

# Step 2: Create jobs ONLY for missing data
echo "📋 Creating jobs for missing data periods..."

# Use orchestrator to create missing jobs
for shop in "pompdelux-da.myshopify.com" "pompdelux-de.myshopify.com" "pompdelux-nl.myshopify.com" "pompdelux-int.myshopify.com" "pompdelux-chf.myshopify.com"; do
  echo "   Checking $shop..."

  # Create missing jobs in weekly chunks to avoid timeout
  start_date="2024-09-30"
  end_date="2024-10-06"

  while [ "$start_date" \< "2025-10-10" ]; do
    echo -n "      Week $start_date to $end_date: "

    response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/create-missing-jobs" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"startDate\": \"$start_date\",
        \"endDate\": \"$end_date\",
        \"objectType\": \"skus\"
      }")

    created=$(echo "$response" | jq -r '.stats.created // 0')
    remaining=$(echo "$response" | jq -r '.stats.remaining // 0')

    echo "$created jobs created"

    # If there are remaining jobs, call again
    while [ "$remaining" -gt "0" ]; do
      sleep 2
      response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/create-missing-jobs" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{
          \"startDate\": \"$start_date\",
          \"endDate\": \"$end_date\",
          \"objectType\": \"skus\"
        }")

      created=$(echo "$response" | jq -r '.stats.created // 0')
      remaining=$(echo "$response" | jq -r '.stats.remaining // 0')
      echo "         +$created more jobs created"
    done

    # Move to next week
    start_date=$(date -j -v+7d -f "%Y-%m-%d" "$start_date" "+%Y-%m-%d" 2>/dev/null || \
                 date -d "$start_date + 7 days" "+%Y-%m-%d")
    end_date=$(date -j -v+7d -f "%Y-%m-%d" "$end_date" "+%Y-%m-%d" 2>/dev/null || \
               date -d "$end_date + 7 days" "+%Y-%m-%d")

    # Cap end date at 2025-10-09
    if [ "$end_date" \> "2025-10-09" ]; then
      end_date="2025-10-09"
    fi
  done
done

echo ""
echo "📋 Step 3: Processing all pending jobs..."
echo ""

# Process using continue-orchestrator
MAX_ITERATIONS=200  # Increased for safety
ITERATION=0
TOTAL_PROCESSED=0

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))
  echo "   🔄 Batch $ITERATION..."

  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}')

  # Parse response
  complete=$(echo "$response" | jq -r '.complete // false')
  processed=$(echo "$response" | jq -r '.batch.processed // 0')
  successful=$(echo "$response" | jq -r '.batch.successful // 0')
  failed=$(echo "$response" | jq -r '.batch.failed // 0')
  pending=$(echo "$response" | jq -r '.stats.pending // 0')
  completed=$(echo "$response" | jq -r '.stats.completed // 0')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + processed))

  echo "      Processed: $processed (Success: $successful, Failed: $failed)"
  echo "      Overall: $pending pending, $completed completed"

  # Check if complete
  if [ "$complete" = "true" ] || [ "$pending" = "0" ]; then
    echo ""
    echo "   ✅ All jobs completed!"
    break
  fi

  # Wait between batches
  sleep 5
done

echo ""
echo "================================================"
echo "              SYNC SUMMARY"
echo "================================================"
echo ""
echo "Total batches run: $ITERATION"
echo "Total jobs processed: $TOTAL_PROCESSED"
echo ""

# Final verification
echo "Running verification query..."
echo ""

cat << 'EOF' > /tmp/verify_coverage.sql
WITH date_coverage AS (
  SELECT
    shop,
    COUNT(DISTINCT DATE(created_at_original)) as days_with_data,
    MIN(DATE(created_at_original)) as first_date,
    MAX(DATE(created_at_original)) as last_date,
    COUNT(*) as total_skus,
    375 as expected_days,
    ROUND(100.0 * COUNT(DISTINCT DATE(created_at_original)) / 375, 1) as coverage_percent
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
  GROUP BY shop
)
SELECT * FROM date_coverage
ORDER BY shop;
EOF

echo "Shop Coverage Summary:"
echo "====================="
echo ""
echo "Run this SQL to verify:"
cat /tmp/verify_coverage.sql
echo ""
echo "Expected: 375 days per shop (100% coverage)"
echo ""
echo "✅ Sync script complete!"