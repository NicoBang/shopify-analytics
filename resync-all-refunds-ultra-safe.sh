#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🛡️  ULTRA-SAFE refunds re-sync (Aug 2024 - Oct 2025)"
echo ""
echo "Strategy:"
echo "  1. Delete old refund jobs"
echo "  2. Create ALL jobs at once via orchestrator"
echo "  3. Monitor progress while continue-orchestrator processes (auto every 5 min)"
echo ""
echo "Advantages:"
echo "  ✅ Zero timeout risk (orchestrator handles all chunking)"
echo "  ✅ Self-healing (continue-orchestrator auto-retries)"
echo "  ✅ Can stop/resume anytime"
echo ""
echo "Time estimate: 2-4 hours (depends on refund volume)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# === STEP 1: Clean up old refund jobs ===
echo ""
echo "🧹 Step 1: Deleting old refund jobs..."
deleted=$(curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=count" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Prefer: count=exact,return=representation" | jq -r 'length')
echo "   ✅ Deleted $deleted old refund jobs"
echo ""

# === STEP 2: Create jobs for entire period ===
echo "📋 Step 2: Creating jobs for Aug 2024 - Oct 2025..."
echo "   (This may take 1-2 minutes and might timeout - that's OK, jobs are still created)"
echo ""

response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2024-08-09", "endDate": "2025-10-22", "objectType": "refunds"}' \
  --max-time 120)

if echo "$response" | grep -q "success"; then
  echo "   ✅ Jobs created successfully!"
elif echo "$response" | grep -q "error"; then
  echo "   ⚠️  Orchestrator returned error (might be timeout):"
  echo "   $response"
  echo ""
  echo "   Checking if jobs were created anyway..."
else
  echo "   ⚠️  Orchestrator timeout (expected for large period)"
  echo "   Checking if jobs were created..."
fi

echo ""
sleep 5

# Check job counts
total=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=count" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Prefer: count=exact" | jq -r '.[0].count')

echo "   📊 Total refund jobs created: $total"
echo ""

if [ -z "$total" ] || [ "$total" = "0" ] || [ "$total" = "null" ]; then
  echo "❌ No jobs created! Something went wrong."
  echo "   Try running orchestrator manually for shorter periods."
  exit 1
fi

# === STEP 3: Monitor progress ===
echo "⏳ Step 3: Monitoring progress..."
echo "   (continue-orchestrator runs automatically every 5 minutes)"
echo "   (You can Ctrl+C to stop monitoring - jobs will continue processing)"
echo ""

start_time=$(date +%s)

while true; do
  # Get job status counts
  status=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq -r 'group_by(.status) | map({status: .[0].status, count: length}) | .[]' | jq -s '.')

  completed=$(echo "$status" | jq -r '.[] | select(.status == "completed") | .count // 0')
  pending=$(echo "$status" | jq -r '.[] | select(.status == "pending") | .count // 0')
  running=$(echo "$status" | jq -r '.[] | select(.status == "running") | .count // 0')
  failed=$(echo "$status" | jq -r '.[] | select(.status == "failed") | .count // 0')

  # Calculate percentage
  pct=$((completed * 100 / total))

  # Calculate elapsed time
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))
  elapsed_min=$((elapsed / 60))

  # Estimate remaining time
  if [ $completed -gt 0 ]; then
    avg_time_per_job=$((elapsed / completed))
    remaining_jobs=$((total - completed))
    est_remaining=$((avg_time_per_job * remaining_jobs / 60))
  else
    est_remaining="unknown"
  fi

  # Display progress
  echo "$(date '+%H:%M:%S') │ Progress: $completed/$total ($pct%) │ Pending: $pending │ Running: $running │ Failed: $failed │ Elapsed: ${elapsed_min}m │ ETA: ${est_remaining}m"

  # Check if done
  if [ "$completed" = "$total" ] && [ "$pending" = "0" ] && [ "$running" = "0" ]; then
    echo ""
    echo "✅ All jobs completed!"
    break
  fi

  # Check if stuck (no progress for 10 minutes)
  if [ $elapsed -gt 600 ] && [ "$completed" = "0" ]; then
    echo ""
    echo "⚠️  No progress after 10 minutes. Possible issues:"
    echo "   - continue-orchestrator might not be running"
    echo "   - Check cron job: SELECT * FROM cron.job WHERE jobname LIKE '%continue%';"
    echo ""
    read -p "Continue monitoring? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      break
    fi
  fi

  sleep 30
done

# === STEP 4: Final summary ===
echo ""
echo "📊 Final Summary:"
echo ""
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&select=status" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq -r 'group_by(.status) | map({status: .[0].status, count: length})'

echo ""
echo "🎉 Refunds re-sync complete!"
echo ""

# Check for failed jobs
failed_count=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?object_type=eq.refunds&status=eq.failed&select=count" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Prefer: count=exact" | jq -r '.[0].count')

if [ "$failed_count" != "0" ] && [ -n "$failed_count" ]; then
  echo "⚠️  $failed_count jobs failed. Check details:"
  echo "   SELECT shop, start_date, error_message FROM bulk_sync_jobs WHERE object_type = 'refunds' AND status = 'failed';"
  echo ""
  echo "   To retry failed jobs:"
  echo "   ./retry-failed-jobs.sh"
fi
