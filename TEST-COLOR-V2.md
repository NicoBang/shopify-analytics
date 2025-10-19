# Test Guide: Color Analytics V2

## Status
✅ Database table created (`daily_sku_transactions`)
✅ Edge Function deployed (`aggregate-sku-transactions`)
✅ Data aggregated for Oct 16, 2024
⏳ API endpoint added (needs deployment)
⏳ Google Sheets function updated (needs push to Apps Script)

---

## Step 1: Deploy API Changes

```bash
# Navigate to project directory
cd /Users/nicolaibang/_projects/shopify-analytics

# Deploy to Vercel (API endpoint changes)
vercel deploy --prod

# Verify deployment
curl "https://shopify-analytics-nu.vercel.app/api/analytics-v2?startDate=2024-10-16T00:00:00Z&endDate=2024-10-16T23:59:59Z&type=color-analytics&apiKey=@Za#SJxn;gnBxJ;Iu2uixoUd&#'ndl" | jq
```

**Expected response**:
```json
{
  "success": true,
  "type": "color-analytics",
  "count": 25,
  "rows": [
    ["Chocolate", 50, 5, 12345.67, 100, 200, 155, 64.52, 10.00, 5000.00, 40.50],
    ...
  ]
}
```

---

## Step 2: Update Google Apps Script

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Find and open **google-sheets-enhanced.js**
4. Copy the updated function from your local file:
   ```bash
   # Show the updated function
   grep -A 120 "function generateStyleColorAnalytics_V2()" google-sheets-enhanced.js
   ```
5. Replace the old function in Apps Script editor
6. Click **Save** (💾)
7. Close Apps Script editor

---

## Step 3: Test in Google Sheets

### Manual Test (Recommended for first test)

1. Open your Google Sheet
2. Go to **Pompdelux → Color Analytics V2** (menu)
3. Enter dates:
   - **Start dato**: `16/10/2024`
   - **Slut dato**: `16/10/2024`
4. **Shop**: Leave empty (or enter `pompdelux-da.myshopify.com`)
5. Click **OK**

**Expected result**:
- Sheet clears and shows Color Analytics data
- Headers: Farve, Solgt (stk), Retur (stk), Omsætning (DKK), etc.
- Data rows with color names and metrics
- Summary section at bottom showing "V2 (Pre-aggregated)"
- Success dialog: "Color Analytics V2 genereret! X farver fundet."

**Performance**:
- Should complete in **2-5 seconds** (vs 15-30s in V1)

---

## Step 4: Validate Results Against V1

### Run V1 for Comparison

1. Create a new sheet (or use another tab)
2. Go to **Pompdelux → Color Analytics** (V1 menu)
3. Enter same dates: `16/10/2024` to `16/10/2024`
4. Wait ~15-30 seconds for V1 to complete

### Compare Key Metrics

Create a comparison table:

| Metric | V1 | V2 | Difference | Acceptable? |
|--------|-----|-----|-----------|-------------|
| Total Solgt | ? | ? | ? | < 1% |
| Total Omsætning | ? | ? | ? | < 1% |
| Total Retur | ? | ? | ? | 0 (exact) |
| Top 3 Colors | ? | ? | ? | Same order |
| Execution Time | ~20s | ~3s | 85% faster | ✅ |

**Acceptance Criteria**:
- ✅ Sold quantity matches exactly (or < 1% difference)
- ✅ Revenue within 1% (minor rounding differences OK)
- ✅ Return quantity matches exactly
- ✅ Top colors in same order (minor DB% differences OK)
- ✅ V2 is 5-10x faster than V1

---

## Step 5: Test Edge Cases

### Test 1: Empty Date Range
- **Dates**: `01/01/2020` to `02/01/2020` (before data exists)
- **Expected**: "Ingen data" dialog

### Test 2: Single Shop
- **Dates**: `16/10/2024` to `16/10/2024`
- **Shop**: `pompdelux-da.myshopify.com`
- **Expected**: Only DA shop data

### Test 3: Long Date Range
- **Dates**: `01/01/2024` to `31/12/2024` (full year)
- **Expected**: Completes in < 10 seconds (vs 60s+ in V1)

### Test 4: Multiple Days
- **Dates**: `01/10/2024` to `18/10/2024` (18 days)
- **Expected**: Aggregated data across all days

---

## Troubleshooting

### Error: "No data found"

**Check 1**: Verify data exists in `daily_sku_transactions`
```sql
SELECT
  metric_date,
  COUNT(*) as transaction_count,
  SUM(quantity_gross) as total_sold
FROM daily_sku_transactions
WHERE metric_date = '2024-10-16'
GROUP BY metric_date;
```

**Expected**: Should return 1 row with transaction_count > 0

**Check 2**: Verify API endpoint responds
```bash
curl "https://shopify-analytics-nu.vercel.app/api/analytics-v2?startDate=2024-10-16T00:00:00Z&endDate=2024-10-16T23:59:59Z&type=color-analytics&apiKey=YOUR_KEY"
```

---

### Error: "Could not connect to API"

**Check 1**: Verify Vercel deployment
```bash
vercel ls shopify-analytics
```

**Check 2**: Check API logs
```bash
vercel logs shopify-analytics --prod
```

**Check 3**: Verify API key in Google Sheets
- Check `CONFIG.API_KEY` matches environment variable

---

### Wrong Results (Revenue Mismatch)

**Check 1**: Compare single SKU between V1 and V2
```sql
-- Check aggregated data
SELECT * FROM daily_sku_transactions
WHERE metric_date = '2024-10-16'
  AND sku = '100515\216/122'
LIMIT 1;

-- Compare with raw SKU data
SELECT
  sku,
  quantity,
  price_dkk,
  cancelled_qty,
  refunded_qty
FROM skus
WHERE created_at_original >= '2024-10-15T22:00:00Z'
  AND created_at_original <= '2024-10-16T21:59:59Z'
  AND sku = '100515\216/122';
```

**Check 2**: Verify revenue calculation
- V2: `revenue_gross = price_dkk × (quantity - cancelled_qty)`
- Should NOT subtract discounts (price_dkk already includes them)

---

### Slow Performance (> 10 seconds)

**Check 1**: Verify indexes exist
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'daily_sku_transactions';
```

**Expected indexes**:
- `daily_sku_transactions_pkey` (shop, metric_date, sku)
- `idx_daily_sku_transactions_date` (metric_date)
- `idx_daily_sku_transactions_shop_date` (shop, metric_date)

**Check 2**: Verify metadata fetching is cached
- Metadata should be fetched once per request (not per SKU)

---

## Success Criteria

Before proceeding to full backfill:

- [x] ✅ Oct 16 data aggregated in `daily_sku_transactions`
- [ ] ✅ V2 API endpoint responds correctly
- [ ] ✅ Google Sheets function works
- [ ] ✅ Results match V1 (< 1% difference)
- [ ] ✅ Performance is 5-10x faster
- [ ] ✅ All edge cases pass

---

## Next Steps After Successful Test

1. **Backfill historical data** (follow V2-DEPLOYMENT.md)
2. **Monitor daily aggregation** (cron job at 2 AM)
3. **Rollout to production** (inform users about V2)
4. **Implement SKU Analytics V2** (same architecture)
5. **Implement Number Analytics V2** (same architecture)

---

## Rollback Plan

If V2 test fails:

1. **Keep using V1** (no changes needed)
2. **Debug V2 issues**:
   - Check revenue calculation
   - Verify SKU extraction
   - Compare metadata handling
3. **Re-aggregate data** if logic changed
4. **Re-test** before production rollout

---

## Contact

If you encounter issues during testing, check:
1. Vercel logs: `vercel logs shopify-analytics --prod`
2. Supabase logs: Supabase Dashboard → Database → Logs
3. Google Apps Script logs: Apps Script Editor → Executions

**Remember**: V1 still works! You can always fall back to V1 while debugging V2.
