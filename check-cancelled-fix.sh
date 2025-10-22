#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "=== Checking cancelled order fix ==="
echo ""
echo "Checking metrics for 2025-10-11 (cancellation date):"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?metric_date=eq.2025-10-11&shop=eq.pompdelux-da.myshopify.com&select=metric_date,return_quantity,return_amount,cancelled_amount" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "Checking metrics for 2025-10-15 (refund date):"
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/daily_shop_metrics?metric_date=eq.2025-10-15&shop=eq.pompdelux-da.myshopify.com&select=metric_date,return_quantity,return_amount,cancelled_amount" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "=== Expected results ==="
echo "2025-10-11: return_quantity = 0, return_amount = 0 (cancelled order should NOT count as return)"
echo "2025-10-15: return_quantity = 0, return_amount = 0 (refund on fully cancelled order should NOT count)"
