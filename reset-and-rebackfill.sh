#!/bin/bash
# Reset aggregated data and re-run backfills with correct timezone

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🗑️  Sletter eksisterende aggregeret data (forkert timezone)..."
echo ""
echo "⚠️  Kør disse SQL queries i Supabase Dashboard SQL Editor:"
echo ""
echo "DELETE FROM daily_shop_metrics;"
echo ""
echo "Tryk Enter når du har kørt SQL kommandoen..."
read

echo ""
echo "✅ Data slettet. Starter re-backfill med korrekte datoer..."
echo ""

# Re-run backfill for 2024-09-01 til 2025-10-15 (ca. 410 dage)
URL="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics"

START_DATE="2024-09-01"
END_DATE="2025-10-15"

CURRENT="$START_DATE"
while [[ "$CURRENT" < "$END_DATE" ]] || [[ "$CURRENT" == "$END_DATE" ]]; do
  echo "  📅 Processing: $CURRENT"

  curl -s -X POST "$URL" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$CURRENT\"}" \
    -o /dev/null

  # Pause mellem requests
  sleep 0.5

  # Næste dag
  CURRENT=$(date -j -v+1d -f "%Y-%m-%d" "$CURRENT" +%Y-%m-%d 2>/dev/null || date -d "$CURRENT + 1 day" +%Y-%m-%d)
done

echo ""
echo "✅ Backfill komplet med korrekte datoer!"
echo ""
echo "📊 Verificer data:"
echo "curl -s 'https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?select=count' -H 'Authorization: Bearer \$KEY' -H 'apikey: \$KEY' -H 'Prefer: count=exact'"
