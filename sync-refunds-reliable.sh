#!/bin/bash

# Reliable refund sync with logging and status tracking
# Usage:
#   ./sync-refunds-reliable.sh 2025-05-01 2025-10-07              # All shops, date range
#   ./sync-refunds-reliable.sh 2025-08-07T00:00 2025-08-07T05:59  # Time-specific (hourly chunks)
#   ./sync-refunds-reliable.sh 2025-08-07 2025-08-07 da           # Single shop only

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE=${1:-"2025-10-01"}
END_DATE=${2:-"2025-10-07"}
SHOP_FILTER=${3:-"all"}  # Filter: all, da, de, nl, int, chf

LOG_FILE="refund-sync-$(date +%Y%m%d-%H%M%S).log"
FAILED_FILE="refund-sync-failed.txt"

# Clear previous failed list
> "$FAILED_FILE"

echo "🔄 Starting refund sync from $START_DATE to $END_DATE" | tee -a "$LOG_FILE"
echo "   Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "   Failed jobs will be saved to: $FAILED_FILE" | tee -a "$LOG_FILE"

# Check if time-based range (contains 'T')
if [[ "$START_DATE" == *"T"* ]]; then
  echo "   ⏰ Time-based mode: using exact timestamps" | tee -a "$LOG_FILE"
fi

if [[ "$SHOP_FILTER" != "all" ]]; then
  echo "   🏪 Shop filter: pompdelux-$SHOP_FILTER.myshopify.com only" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"

# Define shops
ALL_SHOPS=(
  "pompdelux-da.myshopify.com"
  "pompdelux-de.myshopify.com"
  "pompdelux-nl.myshopify.com"
  "pompdelux-int.myshopify.com"
  "pompdelux-chf.myshopify.com"
)

# Filter shops if needed
if [[ "$SHOP_FILTER" == "all" ]]; then
  SHOPS=("${ALL_SHOPS[@]}")
else
  SHOPS=("pompdelux-${SHOP_FILTER}.myshopify.com")
fi

# Time-based mode: use exact timestamps
if [[ "$START_DATE" == *"T"* ]]; then
  # Time-based mode: single range, no iteration
  dates=("$START_DATE|$END_DATE")
  echo "📅 Processing 1 time range × ${#SHOPS[@]} shops = ${#SHOPS[@]} total jobs" | tee -a "$LOG_FILE"
else
  # Date-based mode: generate daily dates
  current_date=$START_DATE
  dates=()
  while [[ "$current_date" < "$END_DATE" ]] || [[ "$current_date" == "$END_DATE" ]]; do
    dates+=("$current_date")
    current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d" 2>/dev/null || date -d "$current_date + 1 day" "+%Y-%m-%d")
  done
  echo "📅 Processing ${#dates[@]} days × ${#SHOPS[@]} shops = $((${#dates[@]} * ${#SHOPS[@]})) total jobs" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"

SUCCESS_COUNT=0
FAILED_COUNT=0
TOTAL_ORDERS=0
TOTAL_SKUS=0

# Process each date/range
for date_range in "${dates[@]}"; do
  # Split time-based range if present
  if [[ "$date_range" == *"|"* ]]; then
    start_ts=$(echo "$date_range" | cut -d'|' -f1)
    end_ts=$(echo "$date_range" | cut -d'|' -f2)
    display_date="$start_ts → $end_ts"
  else
    start_ts="$date_range"
    end_ts="$date_range"
    display_date="$date_range"
  fi

  echo "📆 $display_date" | tee -a "$LOG_FILE"

  for shop in "${SHOPS[@]}"; do
    shop_short=$(echo $shop | cut -d. -f1 | sed 's/pompdelux-//')

    # Call Edge Function
    response=$(curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refund-orders" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"shop\": \"$shop\",
        \"startDate\": \"$start_ts\",
        \"endDate\": \"$end_ts\"
      }")

    # Parse response with better error handling
    parse_error=""
    success=$(echo "$response" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('success', False))" 2>&1)

    # Check if parsing failed
    if [[ "$success" == *"json.decoder.JSONDecodeError"* ]] || [[ "$success" == *"ValueError"* ]] || [[ "$success" == *"KeyError"* ]]; then
      parse_error="JSON parse error"
      # Log first 500 chars of response for debugging
      echo "   ❌ $shop_short: Parse error - response preview:" | tee -a "$LOG_FILE"
      echo "   $(echo "$response" | head -c 500)" | tee -a "$LOG_FILE"
      echo "$display_date|$shop|Parse error - see log" >> "$FAILED_FILE"
      ((FAILED_COUNT++))
      continue
    fi

    if [ "$success" = "True" ]; then
      orders=$(echo "$response" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('ordersProcessed', 0))" 2>/dev/null || echo "0")
      skus=$(echo "$response" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('skusProcessed', 0))" 2>/dev/null || echo "0")

      echo "   ✅ $shop_short: $orders orders, $skus SKUs" | tee -a "$LOG_FILE"
      ((SUCCESS_COUNT++))
      ((TOTAL_ORDERS+=orders))
      ((TOTAL_SKUS+=skus))
    else
      error=$(echo "$response" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('error', 'Unknown error')[:100])" 2>/dev/null || echo "Parse error")
      echo "   ❌ $shop_short: $error" | tee -a "$LOG_FILE"
      echo "$display_date|$shop|$error" >> "$FAILED_FILE"
      ((FAILED_COUNT++))
    fi

    # Small delay
    sleep 1
  done

  echo "" | tee -a "$LOG_FILE"
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "📊 SUMMARY" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "   ✅ Successful: $SUCCESS_COUNT / $((${#dates[@]} * ${#SHOPS[@]}))" | tee -a "$LOG_FILE"
echo "   ❌ Failed:     $FAILED_COUNT" | tee -a "$LOG_FILE"
echo "   📦 Orders:     $TOTAL_ORDERS" | tee -a "$LOG_FILE"
echo "   📦 SKUs:       $TOTAL_SKUS" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [ -s "$FAILED_FILE" ]; then
  echo "⚠️  Failed jobs saved to: $FAILED_FILE" | tee -a "$LOG_FILE"
  echo "   Retry with:" | tee -a "$LOG_FILE"
  echo "   while IFS='|' read date shop error; do ./sync-refunds-reliable.sh \$date \$date; done < $FAILED_FILE" | tee -a "$LOG_FILE"
else
  echo "🎉 All jobs completed successfully!" | tee -a "$LOG_FILE"
  rm -f "$FAILED_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "Full log: $LOG_FILE" | tee -a "$LOG_FILE"
