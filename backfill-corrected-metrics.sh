#!/bin/bash

# Backfill daily_color_metrics and daily_sku_metrics with corrected calculations
# Run AFTER deploying 20251023_fix_cancelled_in_metrics.sql

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE="${1:-2024-09-17}"
END_DATE="${2:-$(date +%Y-%m-%d)}"
BATCH_SIZE="${3:-30}"

echo "🔄 Starting backfill of corrected metrics..."
echo "   Start date: $START_DATE"
echo "   End date: $END_DATE"
echo "   Batch size: $BATCH_SIZE days"
echo ""

response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/backfill-corrected-metrics" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"startDate\": \"$START_DATE\",
    \"endDate\": \"$END_DATE\",
    \"batchSize\": $BATCH_SIZE
  }" \
  --max-time 600)

echo "$response" | jq .

# Check if successful
if echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
  echo ""
  echo "✅ Backfill completed successfully!"

  # Show verification test for 2025-10-21
  echo ""
  echo "🧪 Running verification test for 2025-10-21..."

  curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_color_metrics?metric_date=eq.2025-10-21&select=solgt" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq '[.[].solgt] | add' | xargs -I {} echo "   daily_color_metrics total solgt: {}"

  curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?metric_date=eq.2025-10-21&select=sku_quantity_gross" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" | jq '[.[].sku_quantity_gross] | add' | xargs -I {} echo "   daily_shop_metrics total sku_quantity_gross: {}"
else
  echo ""
  echo "❌ Backfill failed!"
  exit 1
fi
