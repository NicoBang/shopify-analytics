#!/bin/bash
# Test script to validate refund/cancellation fix

echo "🧪 Testing refund vs. cancellation fix..."
echo ""

# 1. Apply migration
echo "1️⃣ Applying migration to add refunded_amount_dkk column..."
PGPASSWORD="$POSTGRES_PASSWORD" psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -f supabase/migrations/*_add_refunded_amount_dkk.sql

echo ""
echo "2️⃣ Deploying updated bulk-sync-refunds function..."
supabase functions deploy bulk-sync-refunds

echo ""
echo "3️⃣ Running refund sync for order 7825660805454's period..."
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-01",
    "endDate": "2025-10-01"
  }' | python3 -m json.tool

echo ""
echo "4️⃣ Checking SKU data for order 7825660805454..."
PGPASSWORD="$POSTGRES_PASSWORD" psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -c "
SELECT
  order_id,
  sku,
  quantity,
  cancelled_qty,
  refunded_qty,
  total_price_dkk,
  cancelled_amount_dkk,
  refunded_amount_dkk,
  refund_date
FROM skus
WHERE order_id = 7825660805454
ORDER BY sku;
"

echo ""
echo "5️⃣ Testing Dashboard API for October 2025..."
curl -s -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-production.vercel.app/api/analytics?startDate=2025-10-01&endDate=2025-10-31&type=dashboard-sku" \
  | python3 -m json.tool

echo ""
echo "✅ Test complete!"
