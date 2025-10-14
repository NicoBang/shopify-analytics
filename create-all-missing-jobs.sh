#!/bin/bash
# Create ALL missing jobs to ensure complete coverage

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🚀 CREATING ALL MISSING JOBS"
echo "============================"
echo ""

# Reset failed jobs first
echo "📋 Resetting failed jobs..."
curl -s -X PATCH "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}' > /dev/null

echo "✓ Failed jobs reset"
echo ""

echo "📋 Creating missing jobs in batches..."
echo "   Period: 2025-10-01 to 2025-10-14 (375 days)"
echo "   Shops: 5 (DA, DE, NL, INT, CHF)"
echo ""

# Process in weekly chunks to avoid timeout
start_date="2025-10-01"
batch_num=1

while [ "$start_date" \< "2025-10-10" ]; do
  # Calculate end date (7 days later, max 2025-10-14)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    end_date=$(date -j -v+6d -f "%Y-%m-%d" "$start_date" "+%Y-%m-%d" 2>/dev/null)
  else
    end_date=$(date -d "$start_date + 6 days" "+%Y-%m-%d")
  fi

  if [ "$end_date" \> "2025-10-14" ]; then
    end_date="2025-10-14"
  fi

  echo "   Batch $batch_num: $start_date to $end_date"

  # Call create-missing-jobs multiple times if needed
  iterations=0
  while [ $iterations -lt 10 ]; do
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

    echo "      Created $created jobs, $remaining remaining"

    if [ "$remaining" = "0" ]; then
      break
    fi

    iterations=$((iterations + 1))
    sleep 1
  done

  # Move to next week
  if [[ "$OSTYPE" == "darwin"* ]]; then
    start_date=$(date -j -v+7d -f "%Y-%m-%d" "$start_date" "+%Y-%m-%d" 2>/dev/null)
  else
    start_date=$(date -d "$start_date + 7 days" "+%Y-%m-%d")
  fi

  batch_num=$((batch_num + 1))
done

echo ""
echo "📊 Checking final job count..."

# Get final counts
response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2025-10-01&start_date=lte.2025-10-14&select=status" \
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

if [ "$total" -lt "1875" ]; then
  echo "⚠️  WARNING: Still missing $((1875 - total)) jobs!"
  echo "   Run this script again to create remaining jobs."
else
  echo "✅ All jobs created successfully!"
fi

echo ""
echo "📋 Now processing all pending jobs..."
echo "   Run: ./fix-and-continue-sync.sh"
echo "   Or wait for auto-processing via cron job"