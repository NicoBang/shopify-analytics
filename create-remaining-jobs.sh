#!/bin/bash

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🚀 Creating remaining jobs until we have all 1875"
echo "================================================="
echo ""

for i in {1..20}; do
  response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/create-missing-jobs" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"startDate":"2024-09-30","endDate":"2025-10-09","objectType":"skus"}')

  created=$(echo "$response" | jq -r '.stats.created // 0' 2>/dev/null || echo "0")
  remaining=$(echo "$response" | jq -r '.stats.remaining // 0' 2>/dev/null || echo "?")

  echo "Run $i: Created $created jobs, $remaining remaining"

  if [ "$created" = "0" ]; then
    echo "✅ No more jobs to create!"
    break
  fi

  sleep 1
done

echo ""
echo "📊 Final status:"

total=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=status" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq 'length')

echo "Total jobs: $total / 1875"

if [ "$total" = "1875" ]; then
  echo "🎉 SUCCESS! All 1875 jobs exist!"
else
  missing=$((1875 - total))
  echo "⚠️  Still missing $missing jobs"
fi