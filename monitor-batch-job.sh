#!/bin/bash

# Monitor Batch Job Progress
# Usage: ./monitor-batch-job.sh <job-id>

JOB_ID=${1:-"aba1f002-d370-448c-8b33-f20aae9ddc0b"}
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "📊 Monitoring job: $JOB_ID"
echo ""

while true; do
  RESULT=$(curl -s "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?id=eq.$JOB_ID&select=status,records_processed,error_message,started_at,completed_at" \
    -H "Authorization: Bearer $KEY" \
    -H "apikey: $KEY")

  STATUS=$(echo "$RESULT" | jq -r '.[0].status // "unknown"')
  PROCESSED=$(echo "$RESULT" | jq -r '.[0].records_processed // 0')
  ERROR_MSG=$(echo "$RESULT" | jq -r '.[0].error_message // ""')
  STARTED=$(echo "$RESULT" | jq -r '.[0].started_at // ""')
  COMPLETED=$(echo "$RESULT" | jq -r '.[0].completed_at // ""')

  clear
  echo "📊 Job Monitor"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Job ID:    $JOB_ID"
  echo "Status:    $STATUS"
  echo "Processed: $PROCESSED orders"
  echo "Started:   $STARTED"
  echo "Completed: $COMPLETED"
  echo ""
  if [ -n "$ERROR_MSG" ]; then
    echo "Progress:  $ERROR_MSG"
  fi
  echo ""
  echo "Last updated: $(date '+%H:%M:%S')"
  echo ""

  if [ "$STATUS" = "completed" ]; then
    echo "✅ Job complete!"
    break
  fi

  if [ "$STATUS" = "failed" ]; then
    echo "❌ Job failed!"
    break
  fi

  sleep 5
done
