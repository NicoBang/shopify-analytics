#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🚀 Safe refunds re-sync strategy (Aug 2024 - Oct 2025)"
echo ""
echo "Strategy: Orchestrator pattern with monthly batches"
echo "  - Create jobs month-by-month"
echo "  - Wait for completion before next month"
echo "  - continue-orchestrator runs every 5 min automatically"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# === STEP 1: Clean up old refund jobs ===
echo "📋 Step 1: Deleting old refund jobs..."
curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
echo "✅ Old jobs deleted"
echo ""

# === STEP 2: Function to sync one month ===
sync_month() {
  local year=$1
  local month=$2

  # Calculate last day of month
  if [ $month -eq 12 ]; then
    local next_month=1
    local next_year=$((year + 1))
  else
    local next_month=$((month + 1))
    local next_year=$year
  fi

  local start_date=$(printf "%04d-%02d-01" $year $month)
  local end_date=$(date -j -f "%Y-%m-%d" "$next_year-$(printf '%02d' $next_month)-01" -v-1d "+%Y-%m-%d" 2>/dev/null || date -d "$next_year-$(printf '%02d' $next_month)-01 - 1 day" "+%Y-%m-%d")

  echo "📅 $(printf '%04d-%02d' $year $month): Creating jobs for $start_date to $end_date"

  # Create jobs via orchestrator
  local response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"startDate\": \"$start_date\", \"endDate\": \"$end_date\", \"objectType\": \"refunds\"}")

  echo "   Response: $response"

  # Wait for jobs to be processed
  echo "   ⏳ Waiting for jobs to complete..."
  local max_wait=900  # 15 minutes max
  local elapsed=0

  while [ $elapsed -lt $max_wait ]; do
    # Check pending jobs count
    local pending=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&status=in.(pending,running)&select=count" \
      -H "apikey: $KEY" \
      -H "Authorization: Bearer $KEY" \
      -H "Prefer: count=exact" | grep -o '"count":[0-9]*' | grep -o '[0-9]*')

    if [ "$pending" = "0" ] || [ -z "$pending" ]; then
      echo "   ✅ Month completed!"
      break
    fi

    echo "   ⏳ $pending jobs remaining... (${elapsed}s elapsed)"
    sleep 30
    elapsed=$((elapsed + 30))
  done

  if [ $elapsed -ge $max_wait ]; then
    echo "   ⚠️  Timeout waiting for month to complete. Moving to next month..."
    echo "      (continue-orchestrator will finish remaining jobs automatically)"
  fi

  echo ""
}

# === STEP 3: Sync all months ===
echo "📆 Step 2: Processing months..."
echo ""

# 2024
sync_month 2024 8
sync_month 2024 9
sync_month 2024 10
sync_month 2024 11
sync_month 2024 12

# 2025
sync_month 2025 1
sync_month 2025 2
sync_month 2025 3
sync_month 2025 4
sync_month 2025 5
sync_month 2025 6
sync_month 2025 7
sync_month 2025 8
sync_month 2025 9
sync_month 2025 10

echo ""
echo "✅ All months processed!"
echo ""
echo "📊 Final status check:"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status,count&order=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "🎉 Done! Check for any failed jobs:"
echo "   SELECT * FROM bulk_sync_jobs WHERE object_type = 'refunds' AND status = 'failed';"
