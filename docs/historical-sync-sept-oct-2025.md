# Historical Data Sync: September-October 2025

## Overview
Historical SKU and refund sync for `pompdelux-da.myshopify.com` covering:
- **Period**: September 1, 2025 - October 31, 2025 (61 days)
- **Initiated**: October 6, 2025 at ~14:59 UTC
- **Status**: ⏳ In Progress

## Sync Configuration
```json
{
  "shop": "pompdelux-da.myshopify.com",
  "startDate": "2025-09-01",
  "endDate": "2025-10-31",
  "includeRefunds": true
}
```

## Process Flow

### 1. SKU Sync (bulk-sync-skus)
- **Method**: Day-by-day processing using Shopify Bulk API
- **Total Days**: 61 days
- **Data Retrieved**:
  - Order IDs
  - Line items (SKUs)
  - Pricing (converted to DKK)
  - Quantities
  - Discounts
  - Tax information
  - Country codes

### 2. Refund Sync (bulk-sync-refunds)
- **Method**: REST API queries for each order
- **Rate Limiting**: 2 requests/second
- **Data Retrieved**:
  - Refund line items
  - Refunded quantities
  - Refund dates
  - Cancelled amounts (DKK)

## Expected Timeline
- **SKU Sync**: ~15-20 minutes (Bulk API processing)
- **Refund Sync**: ~20-30 minutes (REST API rate limits)
- **Total Estimated Time**: 35-50 minutes

## Validation Steps

### After Completion, Run:

1. **Check Overall Status**
```bash
./scripts/monitor-bulk-sync.sh
```

2. **Validate Data Completeness**
```sql
-- Run queries from scripts/validate-historical-sync.sql
```

### Expected Results
- **Total Orders**: ~2,000-3,000 orders (estimate)
- **Total SKU Lines**: ~5,000-10,000 line items
- **Refund Coverage**: Variable (depends on refund rate)
- **Date Coverage**: All 61 days should have data

## Monitoring

### Check Sync Progress
The bulk operation is running in the background. To monitor:

1. **Database Activity**: Database may be slow/timeout during sync
2. **Function Logs**: View in Supabase dashboard under Functions → bulk-sync-skus
3. **Bulk Operation ID**: `gid://shopify/BulkOperation/7607051125070`

### Troubleshooting

**If sync takes longer than 60 minutes:**
1. Check Supabase function logs for errors
2. Verify Shopify API rate limits haven't been hit
3. Check database disk space

**If database timeouts persist:**
- Wait for sync to complete
- Database will be responsive after bulk operations finish

## Post-Sync Actions

### 1. Validate Data
```sql
-- See scripts/validate-historical-sync.sql for full validation queries
```

### 2. Generate Summary Report
```sql
SELECT
  'September-October 2025' as period,
  COUNT(DISTINCT order_id) as total_orders,
  COUNT(*) as total_sku_lines,
  SUM(quantity) as total_qty,
  SUM(refunded_qty) as total_refunded_qty,
  ROUND(SUM(price_dkk * quantity), 2) as total_revenue_dkk,
  ROUND(SUM(cancelled_amount_dkk), 2) as total_refunded_dkk
FROM skus
WHERE shop = 'pompdelux-da.myshopify.com'
  AND created_at >= '2025-09-01'
  AND created_at < '2025-11-01';
```

### 3. Check for Data Gaps
```sql
-- Identify missing days (if any)
-- See scripts/validate-historical-sync.sql query #3
```

## Files Created

1. `/scripts/monitor-bulk-sync.sh` - Progress monitoring script
2. `/scripts/validate-historical-sync.sql` - Validation queries
3. `/docs/historical-sync-sept-oct-2025.md` - This documentation

## Next Steps

1. ✅ Wait for sync to complete (check every 10 minutes)
2. ⏳ Run validation queries
3. ⏳ Generate summary report
4. ⏳ Verify dashboard displays correct data

## Notes

- First request initiated bulk operation ID: `7607051125070`
- Subsequent requests were blocked (expected behavior)
- Database timeouts during sync are normal
- All data will be available once sync completes

## Contact & Support

If sync fails or data is missing:
1. Check function logs in Supabase dashboard
2. Re-run sync for specific date ranges if needed
3. Verify Shopify token permissions
