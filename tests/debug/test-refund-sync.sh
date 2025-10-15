#!/bin/bash
# Test script for refund sync with detailed logging

set -e

echo "🧪 Testing bulk-sync-refunds with updated amount parsing..."
echo ""

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

echo "1️⃣ Testing refund sync for October 2-3, 2025..."
echo ""

# Call the function via Supabase project URL
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-02",
    "endDate": "2025-10-03"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$BODY" | python3 -m json.tool

if [ "$HTTP_CODE" != "200" ]; then
  echo ""
  echo "❌ Function call failed with HTTP $HTTP_CODE"
  echo "Checking Supabase Dashboard logs: https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/logs/edge-functions"
  exit 1
fi

echo ""
echo "2️⃣ Checking database for refunded_amount_dkk updates..."
echo ""

# Query SKUs with refunds
psql "${DATABASE_URL}" -c "
SELECT
  order_id,
  sku,
  quantity,
  cancelled_qty,
  refunded_qty,
  ROUND(total_price_dkk::numeric, 2) as total_price,
  ROUND(cancelled_amount_dkk::numeric, 2) as cancelled_amt,
  ROUND(refunded_amount_dkk::numeric, 2) as refunded_amt,
  refund_date
FROM skus
WHERE refund_date >= '2025-10-02' AND refund_date <= '2025-10-03'
ORDER BY refunded_amount_dkk DESC NULLS LAST
LIMIT 10;
"

echo ""
echo "3️⃣ Checking for SKUs where refunded_amount_dkk is still 0..."
echo ""

psql "${DATABASE_URL}" -c "
SELECT COUNT(*) as zero_refund_count
FROM skus
WHERE refund_date >= '2025-10-02'
  AND refund_date <= '2025-10-03'
  AND refunded_qty > 0
  AND (refunded_amount_dkk IS NULL OR refunded_amount_dkk = 0);
"

echo ""
echo "✅ Test complete!"
echo ""
echo "📊 View detailed logs in Supabase Dashboard:"
echo "https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/logs/edge-functions"
