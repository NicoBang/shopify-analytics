#!/bin/bash
# Get REAL status of what data we actually have

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🔍 REAL DATA STATUS CHECK"
echo "========================="
echo ""

# Check jobs completed in last 30 minutes
echo "📊 Recently completed jobs (last 30 min):"
recent=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.completed&completed_at=gte.$(date -u -v-30M '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -u -d '30 minutes ago' '+%Y-%m-%dT%H:%M:%S')Z&select=shop,start_date" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq -r 'length')

echo "   $recent jobs completed in last 30 minutes"
echo ""

# Check current job status
echo "📊 Current job status:"
response=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY")

pending=$(echo "$response" | jq '[.[] | select(.status == "pending")] | length')
running=$(echo "$response" | jq '[.[] | select(.status == "running")] | length')
completed=$(echo "$response" | jq '[.[] | select(.status == "completed")] | length')
failed=$(echo "$response" | jq '[.[] | select(.status == "failed")] | length')
total=$((pending + running + completed + failed))

echo "   Pending:   $pending"
echo "   Running:   $running"
echo "   Completed: $completed"
echo "   Failed:    $failed"
echo "   ------------------------"
echo "   TOTAL:     $total jobs (should be 1875 = 375 days × 5 shops)"
echo ""

# The REAL test - check actual SKU data
echo "📊 ACTUAL SKU DATA IN DATABASE:"
echo ""

# We need to check the database directly
echo "Run this SQL to see actual coverage:"
echo "--------------------------------------"
cat << 'EOF'
SELECT
  shop,
  COUNT(DISTINCT DATE(created_at_original)) as days_with_data,
  375 as expected_days,
  375 - COUNT(DISTINCT DATE(created_at_original)) as missing_days,
  CASE
    WHEN COUNT(DISTINCT DATE(created_at_original)) = 375 THEN '✅ COMPLETE'
    WHEN COUNT(DISTINCT DATE(created_at_original)) > 350 THEN '⚠️  ALMOST'
    ELSE '❌ INCOMPLETE'
  END as status
FROM skus
WHERE created_at_original >= '2024-09-30'
  AND created_at_original < '2025-10-10'
GROUP BY shop
ORDER BY shop;
EOF

echo ""
echo "🎯 Expected: 375 days for EACH shop"
echo ""

# Quick estimate
if [ "$pending" -gt "0" ]; then
  echo "⏳ Still processing... $pending jobs remaining"
  echo "   Estimated time: $(($pending / 20 * 1)) minutes"
elif [ "$total" -lt "1875" ]; then
  missing=$((1875 - total))
  echo "⚠️  WARNING: Only $total jobs exist (missing $missing jobs)"
  echo "   Need to create missing jobs for complete coverage!"
else
  echo "✅ All jobs exist. Check SQL above for actual data coverage."
fi