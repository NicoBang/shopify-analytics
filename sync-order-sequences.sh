#!/bin/bash

# ============================================================
# Sync Order Sequences from Shopify
# ============================================================
# Purpose: Populate order_sequence_validation table with data from Shopify
# This provides the "source of truth" for detecting missing orders
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SUPABASE_URL="${SUPABASE_URL:-https://ihawjrtfwysyokfotewn.supabase.co}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}"

# Parse arguments
SHOP="${1:-all}"
START_DATE="${2}"
END_DATE="${3}"
TEST_MODE="${4:-false}"

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}Sync Order Sequences from Shopify${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""
echo -e "Shop: ${YELLOW}${SHOP}${NC}"
if [ -n "$START_DATE" ]; then
    echo -e "Date Range: ${YELLOW}${START_DATE} to ${END_DATE:-now}${NC}"
else
    echo -e "Date Range: ${YELLOW}All time${NC}"
fi
if [ "$TEST_MODE" == "true" ]; then
    echo -e "${YELLOW}🧪 TEST MODE - No data will be inserted${NC}"
fi
echo ""

# Build request body
REQUEST_BODY=$(cat <<EOF
{
  "shop": $([ "$SHOP" != "all" ] && echo "\"$SHOP\"" || echo "null"),
  "startDate": $([ -n "$START_DATE" ] && echo "\"${START_DATE}T00:00:00Z\"" || echo "null"),
  "endDate": $([ -n "$END_DATE" ] && echo "\"${END_DATE}T23:59:59Z\"" || echo "null"),
  "testMode": $([ "$TEST_MODE" == "true" ] && echo "true" || echo "false")
}
EOF
)

echo -e "${GREEN}Step 1: Calling sync-order-sequences Edge Function${NC}"
echo ""

# Call Edge Function
RESPONSE=$(curl -s -X POST \
    "${SUPABASE_URL}/functions/v1/sync-order-sequences" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY" \
    2>&1)

# Check if response is valid JSON
if echo "$RESPONSE" | jq empty 2>/dev/null; then
    echo "$RESPONSE" | jq '.'

    # Check success
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
    TOTAL_RECORDS=$(echo "$RESPONSE" | jq -r '.totalRecords // 0')

    if [ "$SUCCESS" == "true" ]; then
        echo ""
        echo -e "${GREEN}✅ Sync completed successfully${NC}"
        echo -e "Total records synced: ${GREEN}${TOTAL_RECORDS}${NC}"
    else
        echo ""
        echo -e "${RED}❌ Sync failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}Error: Invalid response from Edge Function${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo ""

# Only run validation if not in test mode
if [ "$TEST_MODE" != "true" ]; then
    echo -e "${GREEN}Step 2: Running validation check${NC}"
    echo ""

    # Run check script if shop is specified
    if [ "$SHOP" != "all" ] && [ -f "./check-order-sequence.sh" ]; then
        ./check-order-sequence.sh "$SHOP"
    elif [ -f "./check-order-sequence.sh" ]; then
        ./check-order-sequence.sh
    else
        echo -e "${YELLOW}ℹ️  Run ./check-order-sequence.sh to validate data${NC}"
    fi
fi

echo ""
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}Sync Complete${NC}"
echo -e "${BLUE}============================================================${NC}"

# Show usage examples
cat << 'EOF'

📝 Usage Examples:

# Sync all shops (all time)
./sync-order-sequences.sh

# Sync specific shop (all time)
./sync-order-sequences.sh pompdelux-da.myshopify.com

# Sync with date range
./sync-order-sequences.sh pompdelux-da.myshopify.com 2024-09-01 2024-09-30

# Test mode (no data inserted)
./sync-order-sequences.sh pompdelux-da.myshopify.com 2024-09-01 2024-09-30 true

# After sync, check for gaps
./check-order-sequence.sh pompdelux-da.myshopify.com

EOF
