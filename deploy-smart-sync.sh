#!/bin/bash
# Deploy and run Smart SKU Sync as Edge Function

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
SUPABASE_URL="https://ihawjrtfwysyokfotewn.supabase.co"

echo "🚀 SMART SKU SYNC - EDGE FUNCTION VERSION"
echo "=========================================="
echo ""

# Step 1: Deploy the Edge Function
echo "📦 Deploying Edge Function..."
npx supabase functions deploy smart-sku-sync --no-verify-jwt

echo ""
echo "⏳ Waiting for deployment to be ready..."
sleep 5

# Step 2: Create helper SQL functions if needed
echo "📋 Creating helper SQL functions..."
cat << 'EOF' | psql $DATABASE_URL
-- Helper function to find missing periods
CREATE OR REPLACE FUNCTION find_missing_sku_periods(start_date date, end_date date)
RETURNS TABLE(shop text, missing_date date)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(start_date, end_date, '1 day'::interval)::date as sync_date
  ),
  shops AS (
    SELECT unnest(ARRAY[
      'pompdelux-da.myshopify.com',
      'pompdelux-de.myshopify.com',
      'pompdelux-nl.myshopify.com',
      'pompdelux-int.myshopify.com',
      'pompdelux-chf.myshopify.com'
    ]) as shop_name
  ),
  expected AS (
    SELECT s.shop_name, d.sync_date
    FROM shops s
    CROSS JOIN date_range d
  ),
  actual AS (
    SELECT shop, DATE(created_at_original) as sync_date
    FROM skus
    WHERE created_at_original >= start_date
      AND created_at_original <= end_date + interval '1 day'
    GROUP BY shop, DATE(created_at_original)
    HAVING COUNT(*) > 0
  )
  SELECT e.shop_name, e.sync_date
  FROM expected e
  LEFT JOIN actual a ON e.shop_name = a.shop AND e.sync_date = a.sync_date
  WHERE a.sync_date IS NULL
  ORDER BY e.shop_name, e.sync_date;
END;
$$;

-- Helper function to get coverage stats
CREATE OR REPLACE FUNCTION get_sku_coverage(start_date date, end_date date)
RETURNS TABLE(shop text, days_expected int, days_with_data int, coverage_percent numeric, total_skus bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT COUNT(*)::int as total_days
    FROM generate_series(start_date, end_date, '1 day'::interval)
  ),
  coverage AS (
    SELECT
      shop,
      COUNT(DISTINCT DATE(created_at_original))::int as days_with_data,
      COUNT(*) as total_skus
    FROM skus
    WHERE created_at_original >= start_date
      AND created_at_original <= end_date + interval '1 day'
    GROUP BY shop
  )
  SELECT
    s.shop,
    d.total_days as days_expected,
    COALESCE(c.days_with_data, 0)::int as days_with_data,
    ROUND(100.0 * COALESCE(c.days_with_data, 0) / d.total_days, 1) as coverage_percent,
    COALESCE(c.total_skus, 0) as total_skus
  FROM (
    SELECT unnest(ARRAY[
      'pompdelux-da.myshopify.com',
      'pompdelux-de.myshopify.com',
      'pompdelux-nl.myshopify.com',
      'pompdelux-int.myshopify.com',
      'pompdelux-chf.myshopify.com'
    ]) as shop
  ) s
  CROSS JOIN date_range d
  LEFT JOIN coverage c ON s.shop = c.shop
  ORDER BY s.shop;
END;
$$;
EOF

echo ""
echo "🚀 Starting Smart SKU Sync..."
echo ""

# Step 3: Run the sync
response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/smart-sku-sync" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-09-30",
    "endDate": "2025-10-09",
    "mode": "auto"
  }')

# Pretty print response
echo "$response" | jq '.'

echo ""
echo "✅ Sync initiated!"
echo ""
echo "To check progress in real-time, run:"
echo "  watch -n 5 'psql \$DATABASE_URL -c \"SELECT status, COUNT(*) FROM bulk_sync_jobs WHERE object_type='\"'\"'skus'\"'\"' AND start_date >= '\"'\"'2024-09-30'\"'\"' GROUP BY status;\"'"