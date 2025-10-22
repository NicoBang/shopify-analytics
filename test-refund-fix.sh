#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "=== Testing refund fix for two orders ==="
echo ""

# Order 1: 7885243711822 (DK shop, refunded 2025-10-20)
echo "1️⃣ Syncing refunds for DK shop (order 7885243711822)..."
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-20",
    "endDate": "2025-10-20"
  }' | jq '.'

echo ""
echo "Checking DK order result..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/skus?order_id=eq.7885243711822&select=sku,refunded_qty,refunded_amount_dkk,cancelled_qty,cancelled_amount_dkk,price_dkk,tax_rate" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "Expected: refunded_amount_dkk = 135.16 (price_dkk EX VAT, NOT 168.95 INCL VAT)"
echo ""
echo "---"
echo ""

# Order 2: 7426551611658 (INT shop EUR, cancelled 2025-10-14)
echo "2️⃣ Syncing refunds for INT shop (order 7426551611658)..."
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-int.myshopify.com",
    "startDate": "2025-10-14",
    "endDate": "2025-10-14"
  }' | jq '.'

echo ""
echo "Checking INT order result..."
curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/skus?order_id=eq.7426551611658&select=sku,refunded_qty,refunded_amount_dkk,cancelled_qty,cancelled_amount_dkk,price_dkk,tax_rate" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" | jq '.'

echo ""
echo "Expected: cancelled_amount_dkk = 104.50 DKK EX VAT (16.95 EUR × 7.46 / 1.21 = 104.50)"
echo ""
