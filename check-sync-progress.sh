#!/bin/bash
# Check sync progress in real-time

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🔍 CHECKING SYNC STATUS"
echo "======================="
echo ""

# 1. Check job status
echo "📊 Current job status:"
curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&select=status,count:status.count()&order=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "\(.status): \(.count)"' 2>/dev/null || echo "Could not fetch job status"

echo ""

# 2. Check if any jobs are running
echo "🔄 Currently running jobs:"
curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.running&select=shop,start_date,started_at&limit=5" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "\(.shop) - \(.start_date) (started: \(.started_at))"' 2>/dev/null || echo "No running jobs"

echo ""

# 3. Check recent completions
echo "✅ Recently completed (last 5):"
curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.completed&select=shop,start_date,completed_at&order=completed_at.desc&limit=5" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "\(.shop) - \(.start_date)"' 2>/dev/null || echo "No recent completions"

echo ""

# 4. Check data coverage
echo "📈 SKU data coverage (2024-09-30 to 2025-10-09):"
echo ""

# Run SQL query via psql or API
cat << 'EOF' > /tmp/coverage_check.sql
WITH coverage AS (
  SELECT
    shop,
    COUNT(DISTINCT DATE(created_at_original)) as days_with_data,
    MIN(DATE(created_at_original))::text as first_date,
    MAX(DATE(created_at_original))::text as last_date,
    COUNT(*) as total_skus
  FROM skus
  WHERE created_at_original >= '2024-09-30'
    AND created_at_original < '2025-10-10'
  GROUP BY shop
)
SELECT
  shop,
  days_with_data || '/375' as coverage,
  ROUND(100.0 * days_with_data / 375, 1) || '%' as percent,
  total_skus
FROM coverage
ORDER BY shop;
EOF

echo "Shop | Coverage | Percent | Total SKUs"
echo "------|----------|---------|------------"

# If you have psql access
if command -v psql &> /dev/null && [ ! -z "$DATABASE_URL" ]; then
  psql -t -A -F"|" $DATABASE_URL < /tmp/coverage_check.sql 2>/dev/null
else
  echo "Run this SQL in Supabase SQL Editor to see coverage:"
  cat /tmp/coverage_check.sql
fi

echo ""
echo "🔄 To watch live progress, run:"
echo "   watch -n 5 ./check-sync-progress.sh"