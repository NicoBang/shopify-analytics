#!/bin/bash

# Validate and Cleanup Failed Jobs
# Purpose: Automatically validate failed jobs and mark empty days as completed
# Run: ./validate-and-cleanup-failed-jobs.sh

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔍 Validating failed jobs..."
echo ""

# Validate orders
echo "📦 Validating failed order jobs..."
RESULT=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/validate-failed-jobs" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"objectType": "orders"}')

ORDERS_UPDATED=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('updated', 0))" 2>/dev/null || echo "0")
ORDERS_REAL=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('realFailures', 0))" 2>/dev/null || echo "0")

echo "  ✅ Updated: ${ORDERS_UPDATED} empty days"
echo "  ⚠️  Real failures: ${ORDERS_REAL}"
echo ""

# Validate SKUs
echo "📦 Validating failed SKU jobs..."
RESULT=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/validate-failed-jobs" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"objectType": "skus"}')

SKUS_UPDATED=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('updated', 0))" 2>/dev/null || echo "0")
SKUS_REAL=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('realFailures', 0))" 2>/dev/null || echo "0")

echo "  ✅ Updated: ${SKUS_UPDATED} empty days"
echo "  ⚠️  Real failures: ${SKUS_REAL}"
echo ""

# Validate refunds
echo "📦 Validating failed refund jobs..."
RESULT=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/validate-failed-jobs" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"objectType": "refunds"}')

REFUNDS_UPDATED=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('updated', 0))" 2>/dev/null || echo "0")
REFUNDS_REAL=$(echo "$RESULT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('summary', {}).get('realFailures', 0))" 2>/dev/null || echo "0")

echo "  ✅ Updated: ${REFUNDS_UPDATED} empty days"
echo "  ⚠️  Real failures: ${REFUNDS_REAL}"
echo ""

# Summary
TOTAL_UPDATED=$((ORDERS_UPDATED + SKUS_UPDATED + REFUNDS_UPDATED))
TOTAL_REAL=$((ORDERS_REAL + SKUS_REAL + REFUNDS_REAL))

echo "================================"
echo "📊 Summary:"
echo "  Empty days marked as completed: ${TOTAL_UPDATED}"
echo "  Real failures remaining: ${TOTAL_REAL}"
echo "================================"

if [ "$TOTAL_REAL" -gt 0 ]; then
  echo ""
  echo "⚠️  You have ${TOTAL_REAL} real failures that need manual attention!"
fi

echo ""
echo "✅ Validation complete!"
