# Shipping Discount & Refund Migration + Reset

## Session 7: Complete Refund Date Separation Fix

### Problem Solved
Refunds, shipping discounts, and shipping refunds were incorrectly attributed to order creation date instead of actual event dates.

**Example of Wrong Logic:**
- Order created Oct 16 → 10,000 DKK revenue + 39 DKK shipping
- Refund occurred Oct 20 → -2,000 DKK refund + -31.20 DKK shipping refund
- ❌ **BEFORE**: Oct 16 showed 8,000 DKK net revenue (10,000 - 2,000)
- ✅ **AFTER**: Oct 16 shows 10,000 DKK gross, Oct 20 shows -2,000 DKK returns

### What's Fixed

1. **SKU Refunds**: Based on refund_date (not created_at_original)
2. **Shipping Discounts**: Based on order created_at (correct attribution)
3. **Shipping Refunds**: Based on refund_date (NEW - was missing!)

## Step 1: Run Migration (Add New Columns)

Go to Supabase Dashboard → SQL Editor and run:

\`\`\`sql
-- Copy and paste from supabase/migrations/20251015_add_shipping_discount_refund.sql

ALTER TABLE daily_shop_metrics
ADD COLUMN IF NOT EXISTS shipping_discount NUMERIC(12,2) DEFAULT 0;

ALTER TABLE daily_shop_metrics
ADD COLUMN IF NOT EXISTS shipping_refund NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN daily_shop_metrics.shipping_discount IS 'Shipping discounts from orders created on this date (DKK ex VAT)';
COMMENT ON COLUMN daily_shop_metrics.shipping_refund IS 'Shipping refunds that occurred on this date based on refund_date (DKK ex VAT)';

UPDATE daily_shop_metrics SET shipping_discount = 0 WHERE shipping_discount IS NULL;
UPDATE daily_shop_metrics SET shipping_refund = 0 WHERE shipping_refund IS NULL;
\`\`\`

## Step 2: Verify Deployment

Check that aggregate-daily-metrics function is updated:
\`\`\`bash
# Function deployed: 2025-10-15
# Version: 72.82kB (includes shipping refund logic)
\`\`\`

## Step 3: Reset and Re-aggregate

Run the reset script to re-aggregate all data with correct date logic:

\`\`\`bash
./reset-aggregation-refund-fix.sh
\`\`\`

This will:
1. Delete existing aggregated data (wrong refund dates)
2. Re-aggregate 365 days (2024-09-01 to 2025-10-15)
3. Takes approximately 30-40 minutes

## Step 4: Verify Results

After backfill completes, verify with:

\`\`\`sql
SELECT
  metric_date,
  revenue_gross,
  return_amount,
  revenue_net,
  shipping_revenue,
  shipping_discount,
  shipping_refund
FROM daily_shop_metrics
WHERE shop = 'pompdelux-da.myshopify.com'
  AND metric_date >= '2025-10-01'
ORDER BY metric_date;
\`\`\`

### Expected Results

**For orders created on date X:**
- \`revenue_gross\`: Revenue from orders created on X
- \`shipping_revenue\`: Shipping cost from orders created on X
- \`shipping_discount\`: Shipping discounts from orders created on X

**For refunds that occurred on date Y:**
- \`return_amount\`: Refunds that happened on Y (regardless of order creation date)
- \`shipping_refund\`: Shipping refunds that happened on Y

**Net calculations:**
- \`revenue_net = revenue_gross - return_amount\` (both on correct dates)
- Net shipping = \`shipping_revenue - shipping_discount - shipping_refund\`

## Comparison with Existing Logic

### Dashboard & Color_Analytics (ALREADY CORRECT)
✅ Already uses separate queries for:
- Orders: created_at_original filter
- Refunds: refund_date filter (lines 494-497 in analytics.js)

### Pre-aggregation (FIXED IN THIS SESSION)
✅ Now matches Dashboard logic:
- Orders query: created_at_original → revenue_gross, shipping_revenue, shipping_discount
- Refunds query: refund_date → return_amount, return_quantity
- Shipping refunds query: refund_date → shipping_refund

## Files Modified

1. **Migration**: \`supabase/migrations/20251015_add_shipping_discount_refund.sql\`
   - Added shipping_discount column
   - Added shipping_refund column

2. **Aggregation**: \`supabase/functions/aggregate-daily-metrics/index.ts\`
   - Separate query for shipping refunds based on refund_date
   - Added shipping_discount tracking from orders
   - Added shipping_refund tracking from refunds

3. **Documentation**: \`CLAUDE.md\` updated with Session 7 details

## Status

✅ Migration file created
✅ aggregate-daily-metrics deployed (72.82kB)
✅ aggregate-style-metrics deployed (74.14kB)
✅ Reset script ready
⏳ **Next**: Run migration in Supabase Dashboard, then run reset script
