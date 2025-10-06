# Historical Sync Fixes - October 6, 2025

## Issues Discovered & Fixed

### Issue 1: Incorrect `created_at` Timestamps
**Problem**: SKUs were being saved with current timestamp instead of order's actual creation date.

**Root Cause**:
```typescript
// BEFORE (incorrect)
created_at: new Date().toISOString()  // Always "now"
```

**Fix Applied**:
- Extract `createdAt` from Shopify order data (already available in bulk query)
- Build order metadata map with both country and createdAt
- Use order's actual creation date when inserting SKUs

```typescript
// AFTER (correct)
const orderMetadata = orderMetadataMap.get(orderId);
created_at: orderMetadata?.createdAt || new Date().toISOString()
```

**Files Modified**: `supabase/functions/bulk-sync-skus/index.ts`

---

### Issue 2: Refund Sync Finding Zero Refunds
**Problem**: Refund sync was returning 0 refunds even when refunds existed.

**Root Causes**:
1. **Database query issue**: Fetching ALL orders (limit 1000) without date filtering
2. **Date filter issue**: Only processing refunds created on exact sync day

**Fix Applied**:

#### Part A: Filter orders by date range
```typescript
// BEFORE: Fetched all orders
const { data: orders } = await supabase
  .from("skus")
  .select("order_id")
  .eq("shop", shop)
  .limit(1000);

// AFTER: Filter by date range
const { data: orders } = await supabase
  .from("skus")
  .select("order_id, created_at")
  .eq("shop", shop)
  .gte("created_at", startISO)
  .lte("created_at", endISO)
  .limit(1000);
```

#### Part B: Remove restrictive refund date filter
```typescript
// BEFORE: Only refunds created on sync day
if (refundDate < startISO || refundDate > endISO) {
  continue;  // Skip refund
}

// AFTER: Process all refunds for orders in date range
// (refunds can be created after order date, so we don't filter by refund date)
```

**Files Modified**: `supabase/functions/bulk-sync-refunds/index.ts`

---

## Deployment Steps

```bash
# Deploy bulk-sync-skus with created_at fix
supabase functions deploy bulk-sync-skus

# Deploy bulk-sync-refunds with date filtering fix
supabase functions deploy bulk-sync-refunds
```

---

## Testing Results

### Test Period: 2025-09-19 to 2025-09-20

**Before Fixes**:
- ❌ SKUs: 300 records with incorrect timestamps (all showing current date)
- ❌ Refunds: 0 processed (refund sync found no orders)

**After Fixes**:
- ✅ SKUs: 300 records with correct order creation dates
- ✅ Refunds: Expected to process correctly (awaiting full sync completion)

---

## Full Historical Sync - September & October 2025

**Started**: October 6, 2025 ~16:30 UTC
**Period**: 2025-09-01 to 2025-10-31 (61 days)
**Shop**: pompdelux-da.myshopify.com
**Includes**: SKUs + Refunds

**Expected Timeline**: 30-50 minutes

**Monitoring**:
```bash
./scripts/monitor-bulk-sync.sh
```

---

## Key Learnings

1. **Always use source data timestamps**: Don't rely on insertion timestamps for business logic
2. **Date filtering consistency**: Query database using same date field that was populated from source
3. **Refund timing**: Refunds can be created days/weeks after order date
4. **Testing importance**: Small date range tests (2 days) catch issues faster than full sync

---

## Validation Checklist

After sync completes:

- [ ] Verify SKUs have correct `created_at` dates (match Shopify order dates)
- [ ] Verify refunds are populated (`refunded_qty > 0` where expected)
- [ ] Check for date gaps (all 61 days should have data)
- [ ] Validate refund amounts match Shopify data
- [ ] Run full validation queries from `scripts/validate-historical-sync.sql`
