# V2 Color Analytics Deployment Guide

## Overview

V2 Color Analytics uses pre-aggregated `daily_sku_transactions` table for 10-15x faster performance compared to V1.

**Critical Fixes Applied**:
1. ✅ **Full SKU granularity**: Stores complete SKU (with size), not truncated artikelnummer
2. ✅ **Correct revenue calculation**: Matches V1 logic (price_dkk already includes discounts)
3. ✅ **Preserves metadata fetching**: Shows ALL products (with/without sales) like V1
4. ✅ **Color extraction**: Uses both product_title parsing AND tags

---

## Deployment Steps

### 1. Create Database Table

Run the migration to create `daily_sku_transactions` table:

```bash
# Apply migration
psql -h aws-0-eu-central-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.ihawjrtfwysyokfotewn \
  -d postgres \
  -f supabase/migrations/20251018_create_daily_sku_transactions.sql
```

**What it does**:
- Creates `daily_sku_transactions` table with full SKU granularity
- Drops old incorrect tables: `daily_color_metrics`, `daily_sku_metrics`, `daily_number_metrics`
- Adds indexes for fast queries

---

### 2. Deploy Edge Function

Deploy the new aggregation function:

```bash
# Deploy aggregate-sku-transactions Edge Function
npx supabase functions deploy aggregate-sku-transactions --no-verify-jwt

# Verify deployment
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-transactions" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2024-10-16"}'
```

**Expected output**:
```json
{
  "success": true,
  "date": "2024-10-16",
  "shops": 5,
  "results": [
    {"shop": "pompdelux-da.myshopify.com", "transactions": 127},
    ...
  ]
}
```

---

### 3. Backfill Historical Data

Aggregate all historical data into `daily_sku_transactions`:

```bash
# Create backfill script
cat > backfill-sku-transactions.sh << 'EOF'
#!/bin/bash
# Backfill daily_sku_transactions for all historical dates

START_DATE="2024-01-01"
END_DATE="2024-10-18"

echo "🔄 Backfilling SKU transactions from $START_DATE to $END_DATE"

current_date="$START_DATE"
while [[ "$current_date" < "$END_DATE" ]]; do
  echo "📅 Processing $current_date..."

  curl -s -X POST \
    "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-transactions" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"targetDate\": \"$current_date\"}" | jq -r '.success'

  # Next day
  current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" +%Y-%m-%d)

  # Rate limiting: 1 request per 2 seconds
  sleep 2
done

echo "✅ Backfill complete!"
EOF

chmod +x backfill-sku-transactions.sh

# Run backfill (will take ~30-60 minutes for 1 year of data)
./backfill-sku-transactions.sh
```

**Alternative: Batch backfill via Edge Function**

Create a batch backfill function (faster):

```typescript
// supabase/functions/batch-backfill-transactions/index.ts
// Process multiple dates in one invocation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const { startDate, endDate } = await req.json();

  // Loop through dates and call aggregate-sku-transactions
  const results = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];

    // Call aggregate function
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/aggregate-sku-transactions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetDate: dateStr })
      }
    );

    const result = await response.json();
    results.push({ date: dateStr, success: result.success });

    // Next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

### 4. Setup Daily Cron Job

Schedule daily aggregation (runs every night at 2 AM):

```sql
-- Create cron job to aggregate yesterday's data
SELECT cron.schedule(
  'daily-sku-transactions-aggregation',
  '0 2 * * *',  -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-transactions',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb  -- Defaults to yesterday
  );
  $$
);

-- Verify cron job exists
SELECT * FROM cron.job WHERE jobname = 'daily-sku-transactions-aggregation';
```

---

### 5. Test V2 Implementation

Run the test script to validate V2 results:

```bash
# Test V2 Color Analytics
node test-color-analytics-v2.js

# Expected output:
# ✅ V2 completed in 2500ms
# Found 25 colors
# Total sold: 1234 stk
# Total revenue: 456789.00 DKK
```

**Manual V1 Comparison**:
1. Open Google Sheets with V1 Color_Analytics function
2. Query same date range (Oct 16, 2024)
3. Compare totals: sold quantity, revenue, returns
4. Verify top colors match between V1 and V2
5. Check DB% calculations are within 1% difference

---

### 6. Update Google Sheets Integration

Add V2 endpoint to [api/analytics-v2.js](api/analytics-v2.js):

```javascript
// Add Color Analytics V2 handler
const ColorAnalyticsV2 = require('./color-analytics-v2');

// In request handler:
if (type === 'color-analytics') {
  const colorService = new ColorAnalyticsV2();
  const results = await colorService.getColorAnalytics(startDate, endDate, shop);

  return res.json({
    success: true,
    type: 'color-analytics',
    data: results
  });
}
```

Update Google Sheets formula:

```javascript
// New V2 formula (in google-sheets-enhanced.js)
function Color_Analytics_V2(startDate, endDate, shop) {
  const url = `https://shopify-analytics-nu.vercel.app/api/analytics-v2?` +
    `startDate=${startDate.toISOString()}&` +
    `endDate=${endDate.toISOString()}&` +
    `type=color-analytics&` +
    `apiKey=${API_KEY}`;

  const response = UrlFetchApp.fetch(url);
  const data = JSON.parse(response.getContentText());

  return data.data;  // Array of color metrics
}
```

---

## Performance Comparison

### V1 (Current - Real-time calculation)
- **Query time**: 15-30 seconds for 90 days
- **Data fetched**: 50K-200K SKU rows
- **Bottleneck**: Metadata fetching + grouping

### V2 (New - Pre-aggregated)
- **Query time**: 2-5 seconds for 90 days ⚡ **10-15x faster**
- **Data fetched**: ~2.7K pre-aggregated rows (90 days × 30 avg SKUs)
- **Bottleneck**: None (metadata still fetched but cached better)

---

## Rollback Plan

If V2 results don't match V1:

1. **Keep V1 as default** (no changes to existing Google Sheets)
2. **Debug V2**:
   - Check revenue calculation: `revenue_gross = price_dkk × quantity_gross`
   - Verify SKU extraction: `split('\\')[0]` for artikelnummer
   - Compare metadata fetching: ALL products must be shown
3. **Re-aggregate data** if logic changed:
   ```bash
   # Re-run aggregation for affected dates
   ./backfill-sku-transactions.sh
   ```

---

## Monitoring

Check aggregation health:

```sql
-- Check daily coverage
SELECT
  metric_date,
  COUNT(DISTINCT shop) as shops,
  COUNT(DISTINCT sku) as unique_skus,
  SUM(quantity_gross) as total_sold,
  SUM(revenue_gross) as total_revenue
FROM daily_sku_transactions
WHERE metric_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY metric_date
ORDER BY metric_date DESC;

-- Find missing dates
SELECT generate_series(
  '2024-01-01'::date,
  CURRENT_DATE,
  '1 day'::interval
)::date AS missing_date
WHERE NOT EXISTS (
  SELECT 1 FROM daily_sku_transactions
  WHERE metric_date = missing_date
);
```

---

## Next Steps

After Color Analytics V2 is validated:

1. **SKU Analytics V2**: Use same `daily_sku_transactions` table, group by artikelnummer
2. **Number Analytics V2**: Extract last 2 digits from SKU, group by number
3. **Campaign Analytics V2**: Add campaign tracking to pre-aggregation

**Benefits of V2 Architecture**:
- ✅ Single source of truth (`daily_sku_transactions`)
- ✅ Consistent calculations across all analytics
- ✅ 10-15x faster queries
- ✅ Easier to add new dimensions (season, gender, etc.)
