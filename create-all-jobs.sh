#!/bin/bash

# Create all missing jobs incrementally
# Calls create-missing-jobs repeatedly until complete
#
# Usage: ./create-all-jobs.sh [START_DATE] [END_DATE]
# Example: ./create-all-jobs.sh 2025-08-01 2025-09-30

START_DATE="${1:-2025-08-01}"
END_DATE="${2:-2025-09-30}"

echo "📋 Creating all missing jobs for $START_DATE → $END_DATE"
echo ""

COMPLETE=false
ITERATION=1

while [ "$COMPLETE" = "false" ]; do
  echo "🔄 Iteration $ITERATION..."

  RESPONSE=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/create-missing-jobs" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
    -H "Content-Type: application/json" \
    -d "{\"startDate\":\"$START_DATE\",\"endDate\":\"$END_DATE\"}")

  # Extract complete flag using grep/sed
  COMPLETE=$(echo "$RESPONSE" | grep -o '"complete":[^,}]*' | sed 's/"complete"://' | tr -d ' ')

  # Extract stats
  CREATED=$(echo "$RESPONSE" | grep -o '"created":[0-9]*' | sed 's/"created"://')
  REMAINING=$(echo "$RESPONSE" | grep -o '"remaining":[0-9]*' | sed 's/"remaining"://')

  echo "   ✅ Created: $CREATED jobs"
  echo "   📊 Remaining: $REMAINING jobs"
  echo ""

  ITERATION=$((ITERATION + 1))

  # Prevent infinite loop
  if [ $ITERATION -gt 20 ]; then
    echo "⚠️  Max iterations reached - stopping"
    break
  fi

  # Small delay to avoid rate limiting
  sleep 1
done

echo "✅ All jobs created!"
echo ""
echo "🔍 Check status with: ./check-sync-status.sh $START_DATE $END_DATE"
