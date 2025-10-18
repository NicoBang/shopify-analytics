#!/bin/bash

# Continue aggregation from where it left off
# Finds the last aggregated date and continues from there

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
URL_DAILY="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics"
URL_STYLE="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-style-metrics"

echo "🔍 Finding last aggregated date..."

# Get last aggregated date from daily_shop_metrics
LAST_DATE=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?select=metric_date&order=metric_date.desc&limit=1" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" | jq -r '.[0].metric_date' 2>/dev/null)

if [ -z "$LAST_DATE" ] || [ "$LAST_DATE" = "null" ]; then
  echo "❌ No aggregated data found. Run ./reset-aggregation-refund-fix.sh first"
  exit 1
fi

echo "📅 Last aggregated date: $LAST_DATE"

# Calculate next date (macOS and Linux compatible)
if [[ "$OSTYPE" == "darwin"* ]]; then
  NEXT_DATE=$(date -j -v+1d -f "%Y-%m-%d" "$LAST_DATE" "+%Y-%m-%d" 2>/dev/null)
else
  NEXT_DATE=$(date -d "$LAST_DATE + 1 day" +%Y-%m-%d 2>/dev/null)
fi

END_DATE="2025-10-16"

# Check if already complete
if [[ "$LAST_DATE" == "$END_DATE" ]]; then
  echo "✅ Aggregation already complete up to $END_DATE"
  exit 0
fi

echo "▶️  Continuing from: $NEXT_DATE"
echo "🎯 Target end date: $END_DATE"
echo ""

CURRENT="$NEXT_DATE"
COUNT=0

while [[ "$CURRENT" < "$END_DATE" ]] || [[ "$CURRENT" == "$END_DATE" ]]; do
  COUNT=$((COUNT + 1))

  # Progress indicator every 10 days
  if [ $((COUNT % 10)) -eq 0 ]; then
    echo "  📅 Progress: $COUNT days ($CURRENT)"
  fi

  # Aggregate daily metrics
  curl -s -X POST "$URL_DAILY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$CURRENT\"}" > /dev/null

  # Aggregate style metrics
  curl -s -X POST "$URL_STYLE" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$CURRENT\"}" > /dev/null

  sleep 0.5

  if [[ "$OSTYPE" == "darwin"* ]]; then
    CURRENT=$(date -j -v+1d -f "%Y-%m-%d" "$CURRENT" "+%Y-%m-%d" 2>/dev/null)
  else
    CURRENT=$(date -d "$CURRENT + 1 day" +%Y-%m-%d 2>/dev/null)
  fi
done

echo ""
echo "✅ Aggregation complete from $NEXT_DATE to $END_DATE!"
echo "   Total: $COUNT days processed"
