#!/bin/bash
set -e

echo "🚀 Deploying Daily Aggregation System"
echo "======================================"
echo ""

# 1. Deploy Edge Functions
echo "📦 Step 1: Deploying Edge Functions..."
echo "  → aggregate-color-metrics"
npx supabase functions deploy aggregate-color-metrics --no-verify-jwt

echo "  → aggregate-sku-metrics"
npx supabase functions deploy aggregate-sku-metrics --no-verify-jwt

echo "✅ Edge Functions deployed"
echo ""

# 2. Verify cron jobs
echo "🔍 Step 2: Checking existing cron jobs..."
echo "Run this SQL to verify:"
echo ""
echo "SELECT jobid, jobname, schedule, active"
echo "FROM cron.job"
echo "WHERE jobname LIKE '%aggregate%'"
echo "ORDER BY jobname;"
echo ""

# 3. Test Edge Functions manually
echo "🧪 Step 3: Testing Edge Functions..."
echo ""
echo "Testing aggregate-color-metrics for yesterday:"
KEY="${SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}"
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-color-metrics" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"targetDate\": \"$YESTERDAY\"}" \
  --max-time 60

echo ""
echo ""
echo "Testing aggregate-sku-metrics for yesterday:"
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-metrics" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"targetDate\": \"$YESTERDAY\"}" \
  --max-time 60

echo ""
echo ""
echo "✅ Deployment Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Run cron migration (if not already done):"
echo "   psql < supabase/migrations/20251022_setup_daily_aggregation_cron.sql"
echo ""
echo "2. Verify cron jobs are active:"
echo "   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%aggregate%';"
echo ""
echo "3. Monitor logs tomorrow morning to verify automatic execution"
echo ""
