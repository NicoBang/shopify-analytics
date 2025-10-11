#!/bin/bash
# FORCE CREATE ALL 1875 JOBS - More aggressive approach

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🚀 FORCE CREATE ALL 1875 JOBS"
echo "============================="
echo ""

# Define all shops
SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

echo "📋 Creating jobs for each shop and date..."
echo ""

# Process each shop
for shop in "${SHOPS[@]}"; do
  echo "🏪 Processing $shop..."

  # Process in monthly chunks to avoid timeout
  current_date="2024-09-30"

  while [ "$current_date" \< "2025-10-10" ]; do
    # Calculate end date (30 days later, max 2025-10-09)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      end_date=$(date -j -v+29d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d" 2>/dev/null)
    else
      end_date=$(date -d "$current_date + 29 days" "+%Y-%m-%d")
    fi

    if [ "$end_date" \> "2025-10-09" ]; then
      end_date="2025-10-09"
    fi

    echo "   Creating jobs for $current_date to $end_date..."

    # Create jobs directly via SQL
    query="
    INSERT INTO bulk_sync_jobs (
      id, shop, object_type, start_date, end_date,
      status, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      '$shop',
      'skus',
      date::date,
      date::date,
      'pending',
      NOW(),
      NOW()
    FROM generate_series(
      '$current_date'::date,
      '$end_date'::date,
      '1 day'::interval
    ) as date
    ON CONFLICT (shop, object_type, start_date)
    DO NOTHING
    RETURNING id;
    "

    # Execute the query
    response=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/execute_sql" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"$query\"}" 2>/dev/null || echo "")

    # Alternative: Direct insert via REST API
    for (( day=0; day<=29; day++ )); do
      if [[ "$OSTYPE" == "darwin"* ]]; then
        single_date=$(date -j -v+${day}d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d" 2>/dev/null)
      else
        single_date=$(date -d "$current_date + $day days" "+%Y-%m-%d")
      fi

      if [ "$single_date" \> "2025-10-09" ]; then
        break
      fi

      # Insert single job
      curl -s -X POST "$SUPABASE_URL/rest/v1/bulk_sync_jobs" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d "{
          \"shop\": \"$shop\",
          \"object_type\": \"skus\",
          \"start_date\": \"$single_date\",
          \"end_date\": \"$single_date\",
          \"status\": \"pending\"
        }" > /dev/null 2>&1
    done

    # Move to next month
    if [[ "$OSTYPE" == "darwin"* ]]; then
      current_date=$(date -j -v+30d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d" 2>/dev/null)
    else
      current_date=$(date -d "$current_date + 30 days" "+%Y-%m-%d")
    fi
  done

  echo "   ✓ Completed $shop"
done

echo ""
echo "📊 Checking final job count..."

# Get final counts
response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY")

total=$(echo "$response" | jq 'length')
pending=$(echo "$response" | jq '[.[] | select(.status == "pending")] | length')
completed=$(echo "$response" | jq '[.[] | select(.status == "completed")] | length')

echo ""
echo "✅ Job creation complete!"
echo "   Total jobs: $total / 1875 expected"
echo "   Pending: $pending"
echo "   Completed: $completed"
echo ""

if [ "$total" -eq "1875" ]; then
  echo "🎉 ALL JOBS CREATED SUCCESSFULLY!"
  echo ""
  echo "📋 Now run continue-orchestrator to process them:"
  echo "   ./fix-and-continue-sync.sh"
else
  missing=$((1875 - total))
  echo "⚠️  Still missing $missing jobs."
  echo "   Checking which dates are missing..."

  # Check missing dates
  curl -s "$SUPABASE_URL/rest/v1/rpc/check_missing_jobs" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{}" | jq -r '.missing_dates // "Could not determine missing dates"'
fi