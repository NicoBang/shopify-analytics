#!/bin/bash
set -e

echo "🔄 Running daily aggregation cron migration..."
echo ""

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

# Read migration file
MIGRATION_SQL=$(cat supabase/migrations/20251022_setup_daily_aggregation_cron.sql)

# Execute via API
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/rpc/execute_sql" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$MIGRATION_SQL" | jq -Rs .)}"

echo ""
echo "✅ Migration executed"
echo ""
echo "Verifying cron jobs..."

# Verify cron jobs
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/rpc/execute_sql" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE '\''%aggregate%'\'' ORDER BY jobname;"}'

echo ""
echo "Done!"
