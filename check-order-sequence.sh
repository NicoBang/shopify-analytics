#!/bin/bash

# ============================================================
# Order Sequence Validation Helper Script
# ============================================================
# Purpose: Check for missing orders and data consistency issues
# Usage: ./check-order-sequence.sh [shop]
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SUPABASE_URL="${SUPABASE_URL:-https://ihawjrtfwysyokfotewn.supabase.co}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}"

SHOP="${1:-all}"

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}Order Sequence Validation Check${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# ============================================================
# Function: Run SQL query
# ============================================================
run_query() {
    local query="$1"
    local description="$2"

    echo -e "${YELLOW}${description}...${NC}"

    curl -s "${SUPABASE_URL}/rest/v1/rpc/query" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"${query}\"}" \
        2>/dev/null | jq '.' || echo "Query execution error"

    echo ""
}

# ============================================================
# 1. Populate sequence table from orders
# ============================================================
echo -e "${GREEN}Step 1: Populate order sequence table${NC}"
echo -e "SELECT populate_order_sequence_from_orders();"
echo ""

POPULATE_RESULT=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/populate_order_sequence_from_orders" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    2>/dev/null)

echo -e "Records inserted/updated: ${POPULATE_RESULT}"
echo ""

# ============================================================
# 2. Refresh validation flags
# ============================================================
echo -e "${GREEN}Step 2: Refresh validation flags${NC}"
echo -e "SELECT refresh_order_sequence_validation();"
echo ""

REFRESH_RESULT=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/refresh_order_sequence_validation" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    2>/dev/null)

echo "$REFRESH_RESULT" | jq '.'
echo ""

# ============================================================
# 3. Check for sequence gaps
# ============================================================
echo -e "${GREEN}Step 3: Check for sequence gaps (missing order numbers)${NC}"

if [ "$SHOP" != "all" ]; then
    GAPS_URL="${SUPABASE_URL}/rest/v1/order_sequence_gaps?shop=eq.${SHOP}&limit=100"
else
    GAPS_URL="${SUPABASE_URL}/rest/v1/order_sequence_gaps?limit=100"
fi

GAPS=$(curl -s "$GAPS_URL" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    2>/dev/null)

GAPS_COUNT=$(echo "$GAPS" | jq 'length')

if [ "$GAPS_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ No sequence gaps found${NC}"
else
    echo -e "${RED}✗ Found ${GAPS_COUNT} sequence gaps:${NC}"
    echo "$GAPS" | jq -r '.[] | "\(.shop): Missing order #\(.missing_order_number) (Total: \(.total_orders_in_shop) orders, Highest: \(.highest_order_number), Gaps: \(.total_gaps))"'
fi
echo ""

# ============================================================
# 4. Check for missing data in orders/skus
# ============================================================
echo -e "${GREEN}Step 4: Check for orders missing from orders/skus tables${NC}"

if [ "$SHOP" != "all" ]; then
    MISSING_URL="${SUPABASE_URL}/rest/v1/order_sequence_missing_data?shop=eq.${SHOP}&limit=100"
else
    MISSING_URL="${SUPABASE_URL}/rest/v1/order_sequence_missing_data?limit=100"
fi

MISSING=$(curl -s "$MISSING_URL" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    2>/dev/null)

MISSING_COUNT=$(echo "$MISSING" | jq 'length')

if [ "$MISSING_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ All orders exist in both orders and skus tables${NC}"
else
    echo -e "${RED}✗ Found ${MISSING_COUNT} orders with missing data:${NC}"
    echo "$MISSING" | jq -r '.[] | "\(.shop): Order #\(.shopify_order_number) (ID: \(.order_id)) - Missing from: \(.missing_from)"' | head -20

    if [ "$MISSING_COUNT" -gt 20 ]; then
        echo -e "${YELLOW}... (showing first 20 of ${MISSING_COUNT} issues)${NC}"
    fi
fi
echo ""

# ============================================================
# 5. Summary statistics per shop
# ============================================================
echo -e "${GREEN}Step 5: Summary statistics per shop${NC}"

STATS_URL="${SUPABASE_URL}/rest/v1/order_sequence_validation?select=shop,exists_in_orders,exists_in_skus"

if [ "$SHOP" != "all" ]; then
    STATS_URL="${STATS_URL}&shop=eq.${SHOP}"
fi

curl -s "$STATS_URL" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    2>/dev/null | \
    jq -r 'group_by(.shop) | map({
        shop: .[0].shop,
        total: length,
        in_orders: map(select(.exists_in_orders == true)) | length,
        in_skus: map(select(.exists_in_skus == true)) | length,
        missing_orders: map(select(.exists_in_orders == false)) | length,
        missing_skus: map(select(.exists_in_skus == false)) | length
    }) | .[] | "\(.shop): \(.total) total | Orders: \(.in_orders)/\(.total) | SKUs: \(.in_skus)/\(.total) | Missing: \(.missing_orders) orders, \(.missing_skus) SKUs"'

echo ""
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}Check complete${NC}"
echo -e "${BLUE}============================================================${NC}"

# ============================================================
# SQL Queries for Manual Execution
# ============================================================
cat << 'EOF'

📝 Manual SQL Queries (copy/paste into Supabase SQL Editor):

-- 1. Populate sequence table
SELECT populate_order_sequence_from_orders();

-- 2. Refresh validation flags
SELECT * FROM refresh_order_sequence_validation();

-- 3. Find sequence gaps
SELECT * FROM order_sequence_gaps
ORDER BY shop, missing_order_number;

-- 4. Find missing data in orders/skus
SELECT * FROM order_sequence_missing_data
ORDER BY shop, shopify_order_number;

-- 5. Count issues per shop
SELECT
    shop,
    COUNT(*) as total_orders,
    COUNT(*) FILTER (WHERE NOT exists_in_orders) as missing_from_orders,
    COUNT(*) FILTER (WHERE NOT exists_in_skus) as missing_from_skus,
    (SELECT COUNT(*) FROM order_sequence_gaps osg WHERE osg.shop = osv.shop) as sequence_gaps
FROM order_sequence_validation osv
GROUP BY shop
ORDER BY shop;

-- 6. Detailed gap analysis for specific shop
SELECT
    'pompdelux-da.myshopify.com' as shop,
    gs.missing_order_number,
    o.order_id,
    o.name as order_name,
    CASE
        WHEN o.order_id IS NULL THEN 'MISSING'
        WHEN s.order_id IS NULL THEN 'NO_SKUS'
        ELSE 'OK'
    END as status
FROM order_sequence_gaps gs
LEFT JOIN orders o ON o.shop = gs.shop AND o.order_number = gs.missing_order_number
LEFT JOIN skus s ON s.shop = gs.shop AND s.order_id = o.order_id
WHERE gs.shop = 'pompdelux-da.myshopify.com'
ORDER BY gs.missing_order_number
LIMIT 100;

EOF
