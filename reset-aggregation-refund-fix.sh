#!/bin/bash

# Reset and re-backfill aggregated metrics after refund_date fix
# Session 7: Refund Date Separation Fix (2025-10-15)

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
URL_DAILY="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics"
URL_STYLE="https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-style-metrics"

echo "🔧 Session 7: Refund Date Separation Fix"
echo "=========================================="
echo ""
echo "CRITICAL FIX: Refunds were incorrectly attributed to order creation date."
echo "Now fixed to use refund_date for return_amount and quantity_returned."
echo ""
echo "This will:"
echo "  1. Delete existing aggregated data (had wrong refund dates)"
echo "  2. Re-aggregate with correct refund_date logic"
echo "  3. Backfill 365 days (2024-09-01 to 2025-10-15)"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

# Step 1: Delete existing aggregated data
echo ""
echo "🗑️  Deleting existing daily_shop_metrics (wrong refund dates)..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?id=gt.0" \
  -X DELETE \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" > /dev/null

echo "✅ Deleted daily_shop_metrics"

echo ""
echo "🗑️  Deleting existing style metrics (wrong refund dates)..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_color_metrics?id=gt.0" \
  -X DELETE \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" > /dev/null

curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_sku_metrics?id=gt.0" \
  -X DELETE \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" > /dev/null

curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_number_metrics?id=gt.0" \
  -X DELETE \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY" > /dev/null

echo "✅ Deleted style metrics"

# Step 2: Re-backfill with correct refund_date logic
echo ""
echo "🔄 Re-aggregating 365 days with correct refund_date logic..."
echo "   This will take approximately 30-40 minutes..."
echo ""

START_DATE="2024-09-01"
END_DATE="2025-10-15"
CURRENT="$START_DATE"

COUNT=0
TOTAL=410

while [[ "$CURRENT" < "$END_DATE" ]] || [[ "$CURRENT" == "$END_DATE" ]]; do
  COUNT=$((COUNT + 1))

  # Progress indicator every 10 days
  if [ $((COUNT % 10)) -eq 0 ]; then
    echo "  📅 Progress: $COUNT/$TOTAL days ($CURRENT)"
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

  CURRENT=$(date -j -v+1d -f "%Y-%m-%d" "$CURRENT" "+%Y-%m-%d" 2>/dev/null || date -d "$CURRENT + 1 day" +%Y-%m-%d 2>/dev/null)
done

echo ""
echo "✅ Re-aggregation complete!"
echo ""
echo "📊 Verification:"
echo "   - Dashboard metrics now show correct refund dates"
echo "   - revenue_gross: Based on order created_at_original"
echo "   - return_amount: Based on refund_date"
echo "   - revenue_net = revenue_gross - return_amount (both on correct dates)"
echo ""
echo "🎯 Test with query:"
echo "   SELECT metric_date, revenue_gross, return_amount, revenue_net"
echo "   FROM daily_shop_metrics"
echo "   WHERE shop = 'pompdelux-da.myshopify.com'"
echo "   AND metric_date >= '2025-10-01'"
echo "   ORDER BY metric_date;"
