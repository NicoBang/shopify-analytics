#!/bin/bash
# Backfill daily metrics for historical data

KEY="${SUPABASE_SERVICE_ROLE_KEY}"
URL="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics"

# Backfill last 365 days (one year)
echo "🔄 Backfilling daily metrics for last 365 days..."

# Start from 365 days ago
for i in {365..1}; do
  DATE=$(date -v-${i}d +%Y-%m-%d 2>/dev/null || date -d "${i} days ago" +%Y-%m-%d)

  echo "  📅 Processing: $DATE"

  curl -s -X POST "$URL" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$DATE\"}" \
    -o /dev/null

  # Brief pause to avoid rate limiting
  sleep 0.5
done

echo "✅ Backfill complete!"
