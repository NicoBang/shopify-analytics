#!/bin/bash

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Retrying failed jobs..."
echo ""

# de 2025-09-30
echo "📦 Syncing pompdelux-de.myshopify.com - 2025-09-30 - orders"
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-de.myshopify.com","startDate":"2025-09-30","endDate":"2025-09-30","objectType":"orders"}' \
  | python3 -c "import sys, json; r=json.load(sys.stdin); print(f'✅ {r.get(\"status\")}: {r.get(\"ordersProcessed\", 0)} orders') if r.get('success') else print(f'❌ Failed: {r.get(\"error\")}')"

sleep 2

# int 2025-09-28
echo "📦 Syncing pompdelux-int.myshopify.com - 2025-09-28 - orders"
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-int.myshopify.com","startDate":"2025-09-28","endDate":"2025-09-28","objectType":"orders"}' \
  | python3 -c "import sys, json; r=json.load(sys.stdin); print(f'✅ {r.get(\"status\")}: {r.get(\"ordersProcessed\", 0)} orders') if r.get('success') else print(f'❌ Failed: {r.get(\"error\")}')"

sleep 2

# nl 2025-09-29
echo "📦 Syncing pompdelux-nl.myshopify.com - 2025-09-29 - orders"
curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-nl.myshopify.com","startDate":"2025-09-29","endDate":"2025-09-29","objectType":"orders"}' \
  | python3 -c "import sys, json; r=json.load(sys.stdin); print(f'✅ {r.get(\"status\")}: {r.get(\"ordersProcessed\", 0)} orders') if r.get('success') else print(f'❌ Failed: {r.get(\"error\")}')"

echo ""
echo "✅ Done!"
