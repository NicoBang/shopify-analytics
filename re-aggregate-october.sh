#!/bin/bash
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🔄 Re-aggregating October 2024..."
for day in {1..31}; do
  date=$(printf "2024-10-%02d" $day)
  echo "  Processing $date..."
  
  curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-daily-metrics" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$date\"}" > /dev/null
    
  sleep 1
done

echo "✅ October 2024 re-aggregation complete!"
