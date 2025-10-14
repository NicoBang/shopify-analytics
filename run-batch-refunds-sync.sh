#!/bin/bash

# Run Batch Refunds Sync in Loop
# Purpose: Process large refund syncs by calling batch-sync-refunds repeatedly
# Usage: ./run-batch-refunds-sync.sh <shop> <date> [mode]
#   mode: "created_at" (legacy) or "updated_at" (default)

SHOP=${1:-"pompdelux-da.myshopify.com"}
DATE=${2:-"2025-08-07"}
MODE=${3:-"created_at"}
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Batch refunds sync: $SHOP $DATE"
echo "   Mode: $MODE ($([ "$MODE" = "created_at" ] && echo "legacy - order.created_at" || echo "normal - refund.created_at"))"
echo ""

ITERATION=0
TOTAL_PROCESSED=0
JOB_ID=""

while true; do
  ITERATION=$((ITERATION + 1))
  echo "🔄 Iteration $ITERATION..."

  # Build request body with jobId if available
  if [ -z "$JOB_ID" ]; then
    BODY="{\"shop\":\"$SHOP\",\"startDate\":\"$DATE\",\"endDate\":\"$DATE\",\"searchMode\":\"$MODE\",\"batchSize\":50}"
  else
    BODY="{\"shop\":\"$SHOP\",\"startDate\":\"$DATE\",\"endDate\":\"$DATE\",\"searchMode\":\"$MODE\",\"batchSize\":50,\"jobId\":\"$JOB_ID\"}"
  fi

  RESULT=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/batch-sync-refunds" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  echo "$RESULT" | jq

  # Extract job ID for next iteration
  JOB_ID=$(echo "$RESULT" | jq -r '.jobId // ""')

  # Check if complete
  IS_COMPLETE=$(echo "$RESULT" | jq -r '.complete // false')
  BATCH_PROCESSED=$(echo "$RESULT" | jq -r '.batchProcessed // 0')
  TOTAL_PROCESSED=$(echo "$RESULT" | jq -r '.totalProcessed // 0')

  echo "  → Batch: $BATCH_PROCESSED orders, Total: $TOTAL_PROCESSED, Job ID: $JOB_ID"
  echo ""

  if [ "$IS_COMPLETE" = "true" ]; then
    echo "✅ Sync complete! Total orders processed: $TOTAL_PROCESSED"
    break
  fi

  # Check for errors
  if echo "$RESULT" | jq -e '.error' > /dev/null; then
    echo "❌ Error occurred:"
    echo "$RESULT" | jq -r '.error'
    exit 1
  fi

  # Small delay between iterations
  sleep 3
done

echo ""
echo "🎉 All done!"
