#!/bin/bash

# Live sync monitor with auto-refresh
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

clear

echo "📊 LIVE SYNC MONITOR - Shopify SKU Data"
echo "========================================"
echo "Press Ctrl+C to exit"
echo ""

START_TIME=$(date +%s)

while true; do
    # Clear screen but keep header
    tput cup 4 0
    tput ed

    # Get current time
    NOW=$(date "+%Y-%m-%d %H:%M:%S")
    ELAPSED=$(($(date +%s) - START_TIME))
    ELAPSED_MIN=$((ELAPSED / 60))
    ELAPSED_SEC=$((ELAPSED % 60))

    echo -e "${BLUE}⏱️  Time: $NOW (Running: ${ELAPSED_MIN}m ${ELAPSED_SEC}s)${NC}"
    echo "----------------------------------------"

    # Get job counts with proper pagination handling
    # Use Range header with high limit to get total count from content-range
    COMPLETED=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.completed&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=id" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Range: 0-4999" \
        -H "Prefer: count=exact" \
        -I | grep -i "content-range:" | sed 's/.*\///' | tr -d '\r')

    RUNNING=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.running&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=id" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Range: 0-99" \
        -H "Prefer: count=exact" \
        -I | grep -i "content-range:" | sed 's/.*\///' | tr -d '\r')

    PENDING=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.pending&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=id" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Range: 0-4999" \
        -H "Prefer: count=exact" \
        -I | grep -i "content-range:" | sed 's/.*\///' | tr -d '\r')

    FAILED=$(curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.failed&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=id" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Range: 0-999" \
        -H "Prefer: count=exact" \
        -I | grep -i "content-range:" | sed 's/.*\///' | tr -d '\r')

    # Set defaults if empty
    COMPLETED=${COMPLETED:-0}
    RUNNING=${RUNNING:-0}
    PENDING=${PENDING:-0}
    FAILED=${FAILED:-0}

    TOTAL=$((COMPLETED + RUNNING + PENDING + FAILED))

    # Calculate progress
    PROGRESS=$((COMPLETED * 100 / 1875))
    PROGRESS_BAR=""
    for i in $(seq 1 50); do
        if [ $i -le $((PROGRESS / 2)) ]; then
            PROGRESS_BAR="${PROGRESS_BAR}█"
        else
            PROGRESS_BAR="${PROGRESS_BAR}░"
        fi
    done

    # Display status
    echo -e "${GREEN}✅ Completed:${NC} $COMPLETED"
    echo -e "${YELLOW}🔄 Running:${NC}   $RUNNING"
    echo -e "${BLUE}⏳ Pending:${NC}   $PENDING"
    if [ "$FAILED" -gt "0" ]; then
        echo -e "${RED}❌ Failed:${NC}    $FAILED"
    fi
    echo "------------------------"
    echo -e "📦 Total:     $TOTAL / 1875"
    echo ""

    # Progress bar
    echo -e "Progress: ${GREEN}$PROGRESS_BAR${NC} ${PROGRESS}%"
    echo ""

    # Get currently running jobs details
    if [ "$RUNNING" -gt "0" ]; then
        echo "🔄 Currently syncing:"
        curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.running&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=shop,start_date" \
            -H "apikey: $SERVICE_KEY" \
            -H "Authorization: Bearer $SERVICE_KEY" \
            -H "Range: 0-19" | jq -r '.[] | "   • \(.shop | split(".")[0] | split("-")[1] | ascii_upcase): \(.start_date)"' 2>/dev/null || echo "   (loading...)"
        echo ""
    fi

    # Estimate time remaining
    if [ "$PENDING" -gt "0" ] && [ "$RUNNING" -gt "0" ]; then
        RATE=$((RUNNING * 2)) # Approximate: 20 jobs per batch, ~30 seconds per job
        if [ "$RATE" -gt "0" ]; then
            MINUTES_LEFT=$((PENDING / RATE))
            echo "⏱️  Estimated time remaining: ~${MINUTES_LEFT} minutes"
        fi
    elif [ "$PENDING" -eq "0" ] && [ "$RUNNING" -eq "0" ]; then
        echo -e "${GREEN}🎉 SYNC COMPLETE!${NC}"
        echo ""

        # Show completion summary
        echo "📊 Summary:"
        echo "   • Period: 2024-09-30 to 2025-10-09"
        echo "   • Shops: 5 (DA, DE, NL, INT, CHF)"
        echo "   • Days: 375 per shop"
        echo "   • Total jobs: $COMPLETED completed"

        if [ "$FAILED" -gt "0" ]; then
            echo -e "   ${RED}• Failed jobs: $FAILED (need attention)${NC}"
        fi
    else
        echo "⏸️  Waiting for orchestrator to pick up jobs..."
    fi

    # Recently completed (last 5)
    echo ""
    echo "📝 Recently completed:"
    curl -s "$SUPABASE_URL/rest/v1/bulk_sync_jobs?object_type=eq.skus&status=eq.completed&start_date=gte.2024-09-30&start_date=lte.2025-10-09&select=shop,start_date,completed_at&order=completed_at.desc&limit=5" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "   • \(.shop | split(".")[0] | split("-")[1] | ascii_upcase): \(.start_date)"' 2>/dev/null || echo "   (loading...)"

    # Refresh every 5 seconds
    sleep 5
done