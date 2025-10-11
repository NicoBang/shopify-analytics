#!/bin/bash

# Create all missing refund jobs incrementally
# Calls create-missing-jobs repeatedly until complete for refunds
#
# Usage:
#   ./create-all-refund-jobs.sh [START_DATE] [END_DATE] [SHOP]
# Example:
#   ./create-all-refund-jobs.sh 2024-09-01 2024-10-31
#   ./create-all-refund-jobs.sh 2024-09-01 2024-10-31 pompdelux-da.myshopify.com

START_DATE="${1:-2024-09-01}"
END_DATE="${2:-2024-10-31}"
SHOP="${3}"

SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "📋 Creating all missing refund jobs for $START_DATE → $END_DATE${SHOP:+ (shop: $SHOP)}"
COMPLETE=false
ITERATION=1

while [ "$COMPLETE" = false ]; do
  echo "🔄 Iteration $ITERATION..."

  if [ -n "$SHOP" ]; then
    BODY='{"shop":"'"$SHOP"'","startDate":"'"$START_DATE"'","endDate":"'"$END_DATE"'","objectType":"refunds"}'
  else
    BODY='{"startDate":"'"$START_DATE"'","endDate":"'"$END_DATE"'","objectType":"refunds"}'
  fi

  RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/create-missing-jobs" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  COMPLETE=$(echo "$RESPONSE" | grep -o '"complete":[^,}]*' | sed 's/"complete"://' | tr -d ' ')
  CREATED=$(echo "$RESPONSE" | grep -o '"created":[0-9]*' | sed 's/"created"://')
  REMAINING=$(echo "$RESPONSE" | grep -o '"remaining":[0-9]*' | sed 's/"remaining"://')

  echo "   ✅ Created: ${CREATED:-0} jobs"
  echo "   📊 Remaining: ${REMAINING:-unknown} jobs"
  echo "   ↪︎ Raw: $RESPONSE"

  if [ "$COMPLETE" = "true" ]; then
    break
  fi

  ITERATION=$((ITERATION + 1))
  if [ $ITERATION -gt 100 ]; then
    echo "⚠️  Max iterations reached - stopping"
    break
  fi

  sleep 1
done

echo "✅ All refund jobs created!"
echo "🔍 Check status with: ./check-sync-status.sh $START_DATE $END_DATE"
