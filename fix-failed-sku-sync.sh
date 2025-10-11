#!/bin/bash
# Fix failed SKU sync jobs and resync missing days
# Date: 2025-10-09

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🔧 Fixing Failed SKU Sync Jobs"
echo "=============================="
echo ""

# Step 1: Reset failed jobs to pending
echo "📋 Step 1: Resetting failed SKU jobs to pending status..."
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"status": "pending", "error_message": null}' | jq '.[] | {shop, start_date}' | head -20

echo ""
echo "📋 Step 2: Creating jobs for missing dates..."

# Specific missing dates per shop
declare -A MISSING_DATES

# pompdelux-da: 2025-10-08, 2025-10-09
MISSING_DATES["pompdelux-da.myshopify.com"]="2025-10-08 2025-10-09"

# pompdelux-de: 2025-10-08, 2025-10-09
MISSING_DATES["pompdelux-de.myshopify.com"]="2025-10-08 2025-10-09"

# pompdelux-nl: 2025-09-06, 2025-10-08, 2025-10-09
MISSING_DATES["pompdelux-nl.myshopify.com"]="2025-09-06 2025-10-08 2025-10-09"

# pompdelux-int: 2025-09-08, 2025-10-08, 2025-10-09
MISSING_DATES["pompdelux-int.myshopify.com"]="2025-09-08 2025-10-08 2025-10-09"

# pompdelux-chf: 2025-09-07, 2025-10-08, 2025-10-09
MISSING_DATES["pompdelux-chf.myshopify.com"]="2025-09-07 2025-10-08 2025-10-09"

# Create missing jobs
for shop in "${!MISSING_DATES[@]}"; do
  echo "   Creating jobs for $shop..."
  for date in ${MISSING_DATES[$shop]}; do
    echo "      - $date"
    curl -s -X POST "$SUPABASE_URL/rest/v1/bulk_sync_jobs" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "{
        \"shop\": \"$shop\",
        \"start_date\": \"$date\",
        \"end_date\": \"$date\",
        \"object_type\": \"skus\",
        \"status\": \"pending\",
        \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\"
      }" > /dev/null
  done
done

echo ""
echo "📋 Step 3: Processing all pending SKU jobs..."
echo ""

# Process pending jobs in batches
MAX_ITERATIONS=50
COMPLETED=false

for i in $(seq 1 $MAX_ITERATIONS); do
  echo "   🔄 Processing batch $i..."

  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/continue-orchestrator" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}')

  # Check if complete
  if echo "$response" | grep -q '"complete":true'; then
    echo "   ✅ All jobs completed!"
    COMPLETED=true
    break
  fi

  # Show progress
  pending=$(echo "$response" | jq -r '.stats.pending // 0')
  completed=$(echo "$response" | jq -r '.stats.completed // 0')
  failed=$(echo "$response" | jq -r '.stats.failed // 0')

  echo "      Status: $pending pending, $completed completed, $failed failed"

  # Stop if no pending jobs
  if [ "$pending" = "0" ] || [ "$pending" = "null" ]; then
    echo "   ✅ No more pending jobs!"
    COMPLETED=true
    break
  fi

  # Wait before next batch
  sleep 10
done

if [ "$COMPLETED" = false ]; then
  echo "   ⚠️  Reached max iterations. Some jobs may still be pending."
  echo "   Run 'continue-orchestrator' manually to process remaining jobs."
fi

echo ""
echo "📊 Step 4: Final Status Check"
echo ""

# Get final status
curl -s -X POST "$SUPABASE_URL/functions/v1/sku-sync-status" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.summary'

echo ""
echo "✅ Script complete!"
echo ""
echo "To verify coverage, run this SQL:"
echo "----------------------------------------"
cat << 'EOF'
WITH date_coverage AS (
  SELECT
    shop,
    DATE(created_at_original) as date,
    COUNT(*) as sku_count
  FROM skus
  WHERE created_at_original >= '2025-09-01'
  GROUP BY shop, DATE(created_at_original)
)
SELECT
  shop,
  COUNT(*) as days_with_data,
  MIN(date) as first_date,
  MAX(date) as last_date,
  SUM(sku_count) as total_skus
FROM date_coverage
GROUP BY shop
ORDER BY shop;
EOF