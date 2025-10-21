#!/bin/bash
# Test fix for single day: 2025-08-12 (129 SKUs affected)

set -e

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧪 Testing refund fix for 2025-08-12..."
echo ""

# Delete existing job
echo "1️⃣ Deleting existing job..."
curl -s -X DELETE "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?shop=eq.pompdelux-da.myshopify.com&start_date=eq.2025-08-12&object_type=eq.refunds" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $KEY"

echo ""
echo "2️⃣ Running bulk-sync-refunds..."
result=$(curl -s -X POST https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refunds \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-da.myshopify.com","startDate":"2025-08-12","endDate":"2025-08-12"}')

echo "Result: $result"
echo ""

echo "3️⃣ Checking for remaining issues on 2025-08-12..."
echo ""

# Check if any SKUs still have refunded_amount_dkk > price_dkk for this date
cat > /tmp/check-2025-08-12.sql << 'SQL'
SELECT 
  COUNT(*) as still_broken_count,
  COUNT(DISTINCT order_id) as orders_affected
FROM skus
WHERE refund_date::date = '2025-08-12'
  AND refunded_qty > 0
  AND refunded_amount_dkk > price_dkk;
SQL

echo "SQL query to check if fix worked (run in Supabase SQL Editor):"
cat /tmp/check-2025-08-12.sql
echo ""
echo "✅ Test complete!"
echo ""
echo "Expected before fix: 129 SKUs broken"
echo "Expected after fix: 0 SKUs broken"
