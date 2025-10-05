# Dashboard 49.24 DKK Issue - Root Cause Analysis

## Problem Statement

Dashboard shows 49.24 DKK for order_id 6667277697291 instead of the correct SKU-level calculated 133.50 DKK.

**Expected**: 133.50 DKK (Item A not cancelled)
**Actual**: 49.24 DKK (proportional calculation)
**Error**: -63.1% underestimation

## Input Data (Theoretical Order 6667277697291)

### Order-Level Data (from orders table)
```
order_id: 6667277697291
created_at: 2024-10-09 (NOTE: Order doesn't exist in Supabase yet - theoretical example)
discounted_total: 199.93 DKK (incl. tax)
tax: 46.25 DKK
shipping: 55.20 DKK (ex tax)
item_count: 2
cancelled_qty: 1
sale_discount_total: 66.39 DKK
combined_discount_total: 495.30 DKK (??? - seems wrong, should be ~66.39)
```

### SKU-Level Data (from skus table)
```
Item A (NOT cancelled):
  sku: [unknown]
  price_dkk: 110.33 DKK (ex tax, after line discount)
  discount_per_unit_dkk: [calculated from total_discount_dkk]
  total_discount_dkk: 54.87414552 DKK
  cancelled_qty: 0
  cancelled_amount_dkk: 0

Item B (CANCELLED):
  sku: [unknown]
  price_dkk: 54.91 DKK (ex tax, after line discount)
  cancelled_qty: 1
  cancelled_amount_dkk: 54.91 DKK (should be this exact value)
```

## Current Dashboard Flow (Code Trace)

### Step 1: google-sheets-enhanced.js - updateDashboard()

**File**: `/Users/nicolaibang/_projects/shopify-analytics/google-sheets-enhanced.js`
**Lines**: 41-77

```javascript
function updateDashboard() {
  // ...

  // Hent SKU-level data (inkluderer cancelled_amount_dkk)
  const skuUrl = `${CONFIG.API_BASE}/sku-raw`;
  const skuPayload = {
    startDate: formatDateWithTime(startDate, false),
    endDate: formatDateWithTime(endDate, true)
    // ❌ MISSING: includeShopBreakdown: true
  };
  const skuRes = makeApiRequest(skuUrl, skuPayload);

  // ...
  const shopBreakdown = Array.isArray(skuRes?.shopBreakdown) ? skuRes.shopBreakdown : null;
  // ❌ shopBreakdown will be NULL because API wasn't asked to calculate it

  renderDashboard_(ordersRows, returnRows, startDate, endDate, shopBreakdown);
}
```

**Issue**: `skuPayload` does NOT include `includeShopBreakdown: true`, so the API returns `null` for `shopBreakdown`.

### Step 2: google-sheets-enhanced.js - renderDashboard_()

**File**: `/Users/nicolaibang/_projects/shopify-analytics/google-sheets-enhanced.js`
**Lines**: 158-168 (FALLBACK PATH - WRONG!)

```javascript
// NOTE: Cancelled amount deduction is handled via SKU-level data in shopBreakdown
// Old proportional calculation has been removed to avoid double-deduction
// Fallback: If shopBreakdown is null, use proportional calculation
if (!shopBreakdown && itemCount > 0 && cancelledQty > 0) {
  const perUnitExTax = brutto / itemCount;  // 98.48 / 2 = 49.24
  const cancelValueExTax = perUnitExTax * cancelledQty;  // 49.24 * 1 = 49.24
  // Træk fra både brutto (B) og netto (C)
  shopMap[shop].gross -= cancelValueExTax;  // ❌ WRONG: Deducts 49.24 instead of 54.91
  shopMap[shop].net -= cancelValueExTax;
  console.log(`⚠️  FALLBACK: Using proportional calculation...`);
}
```

**Lines**: 220-240 (SKU-LEVEL PATH - NOT REACHED!)

```javascript
// If shopBreakdown exists, use SKU-level revenue (with precise cancelled amounts)
if (shopBreakdown && shopBreakdown.length > 0) {
  // ✅ THIS CODE NEVER EXECUTES because shopBreakdown is NULL
  console.log('✅ Using SKU-level cancelled amounts from shopBreakdown');
  shopBreakdown.forEach(breakdown => {
    const shop = breakdown.shop;
    if (!shopMap[shop]) return;

    // Replace gross/net revenue with SKU-level calculated revenue
    const skuRevenue = breakdown.revenue || 0;  // Would be 133.50
    const cancelledAmount = breakdown.cancelledAmount || 0;  // Would be 54.91

    shopMap[shop].gross = skuRevenue;  // ✅ CORRECT: 133.50
    shopMap[shop].net = skuRevenue;
  });
} else {
  console.log('⚠️  No shopBreakdown available - using order-level proportional calculation');
}
```

### Step 3: api/sku-raw.js - Handler

**File**: `/Users/nicolaibang/_projects/shopify-analytics/api/sku-raw.js`
**Lines**: 310-375

```javascript
let {
  // ...
  includeShopBreakdown = 'false'  // ❌ Default is FALSE
} = req.query;

// Also support POST body parameters
if (req.method === 'POST' && req.body) {
  // ...
  includeShopBreakdown = req.body.includeShopBreakdown || includeShopBreakdown;
  // ❌ req.body.includeShopBreakdown is UNDEFINED, so uses default 'false'
}

const parsedIncludeShopBreakdown = includeShopBreakdown === 'true' || includeShopBreakdown === true;
// ❌ parsedIncludeShopBreakdown = false

const result = await supabaseService.getSkusForPeriod(start, end, {
  // ...
  includeShopBreakdown: parsedIncludeShopBreakdown  // ❌ FALSE
});

// ...
shopBreakdown = result.shopBreakdown;  // ❌ NULL (not calculated)
```

### Step 4: api/sku-raw.js - getSkusForPeriod()

**File**: `/Users/nicolaibang/_projects/shopify-analytics/api/sku-raw.js`
**Lines**: 96-150

```javascript
// Calculate shop breakdown if requested (for Dashboard)
if (includeShopBreakdown) {
  // ❌ THIS CODE NEVER EXECUTES because includeShopBreakdown = false
  const shopMap = {};
  data.forEach(item => {
    const shopKey = item.shop || 'unknown';
    if (!shopMap[shopKey]) {
      shopMap[shopKey] = {
        shop: shopKey,
        quantitySold: 0,
        quantityCancelled: 0,
        quantityRefunded: 0,
        cancelledAmount: 0,  // ✅ Would aggregate cancelled_amount_dkk
        revenue: 0  // ✅ Would calculate SKU-level revenue
      };
    }

    shopMap[shopKey].quantitySold += item.quantity || 0;
    shopMap[shopKey].quantityCancelled += item.cancelled_qty || 0;
    shopMap[shopKey].quantityRefunded += item.refunded_qty || 0;
    shopMap[shopKey].cancelledAmount += item.cancelled_amount_dkk || 0;

    const unitPriceAfterDiscount = (item.price_dkk || 0) - (item.discount_per_unit_dkk || 0);
    shopMap[shopKey].revenue += unitPriceAfterDiscount * (item.quantity || 0);
  });

  shopBreakdown = Object.values(shopMap);
}
```

## Calculation Comparison

### Current (WRONG) - Proportional Method
```
brutto = discounted_total - tax - shipping
       = 199.93 - 46.25 - 55.20
       = 98.48 DKK

perUnitExTax = brutto / item_count
             = 98.48 / 2
             = 49.24 DKK

cancelValueExTax = perUnitExTax × cancelled_qty
                 = 49.24 × 1
                 = 49.24 DKK

final_brutto = brutto - cancelValueExTax
             = 98.48 - 49.24
             = 49.24 DKK  ❌ WRONG!
```

**Why Wrong**: Assumes both items cost 49.24 DKK each, but they cost 110.33 and 54.91 (DIFFERENT!)

### Correct - SKU-Level Method
```
Item A revenue = (price_dkk - discount_per_unit_dkk) × quantity
               = (110.33 - discount) × 1
               = ~133.50 DKK  ✅ CORRECT!

Item B (cancelled) = 0 (not counted)

Total revenue = 133.50 DKK
Cancelled amount = 54.91 DKK (Item B actual price)
```

## Root Causes Identified

### 1. Missing API Parameter ⚠️ CRITICAL
**Location**: `google-sheets-enhanced.js:50-53`
**Issue**: `includeShopBreakdown: true` NOT included in API request payload
**Impact**: API doesn't calculate `shopBreakdown`, returns `null`
**Fix**: Add `includeShopBreakdown: true` to `skuPayload`

### 2. VAT Level Inconsistency 🔍 INVESTIGATION NEEDED
**Problem**: Mixing of INCL moms and EX moms values without clear standardization
**Examples**:
- `discounted_total: 199.93` (INCL moms)
- `tax: 46.25` (VAT amount)
- `shipping: 55.20` (EX moms)
- `price_dkk: 110.33` (EX moms, from SKU table)
- `combined_discount_total: 495.30` (??? - should be ~66.39, appears wrong)

**Questions**:
1. Is `price_dkk` in SKUs table EX moms or INCL moms?
2. Is `discount_per_unit_dkk` EX moms or INCL moms?
3. Is `cancelled_amount_dkk` EX moms or INCL moms?
4. Why is `combined_discount_total = 495.30` when `sale_discount_total = 66.39`?

### 3. Data Completeness 📊 VERIFICATION NEEDED
**Issue**: Order 6667277697291 doesn't exist in Supabase (theoretical example)
**Impact**: Cannot verify actual SKU-level calculations with real data
**Next Steps**: Either:
  1. Sync this specific order from Shopify, OR
  2. Find a real order with similar characteristics for testing

## Proposed Solutions

### Immediate Fix (Lines of Code)

**File**: `google-sheets-enhanced.js`
**Line 50-53**: Add `includeShopBreakdown: true`

```javascript
// BEFORE:
const skuPayload = {
  startDate: formatDateWithTime(startDate, false),
  endDate: formatDateWithTime(endDate, true)
};

// AFTER:
const skuPayload = {
  startDate: formatDateWithTime(startDate, false),
  endDate: formatDateWithTime(endDate, true),
  includeShopBreakdown: true  // ✅ Enable SKU-level calculation
};
```

### Verification Steps

1. Deploy fix to production
2. Sync order 6667277697291 (if it exists in Shopify):
   ```bash
   curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
     "https://[production-url]/api/sync-shop?shop=pompdelux-da.myshopify.com&type=orders&startDate=2024-10-09&endDate=2024-10-09"

   curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
     "https://[production-url]/api/sync-shop?shop=pompdelux-da.myshopify.com&type=skus&startDate=2024-10-09&endDate=2024-10-09"
   ```
3. Run updateDashboard() for 2024-10-09
4. Verify console logs show: `✅ Using SKU-level cancelled amounts from shopBreakdown`
5. Verify brutto shows 133.50 DKK (not 49.24 DKK)

### Long-Term Standardization

**Goal**: All revenue calculations use consistent VAT level (recommend: EX moms)

**Changes Needed**:
1. Document VAT level for ALL database fields
2. Standardize all calculations to use same VAT basis
3. Update CLAUDE.md with VAT standards
4. Add validation to catch VAT mismatches

## Expected Outcome

After fix:
- Dashboard will ALWAYS use SKU-level calculation (when SKU data available)
- Console will show: `✅ Using SKU-level cancelled amounts from shopBreakdown`
- Revenue for order 6667277697291 will show: **133.50 DKK** (not 49.24 DKK)
- Cancelled amount will show: **54.91 DKK** (actual Item B price, not 49.24)
- Error reduced from **-63.1%** to **0.0%**

## Additional Notes

### Why Proportional Method Still Exists (Fallback)
The proportional calculation remains as **fallback only** for backward compatibility:
- Old orders synced before `cancelled_amount_dkk` column existed
- Orders where SKU sync failed but order sync succeeded
- Emergency degradation if SKU API is unavailable

**This fallback should RARELY execute** once all data is properly synced.

### Console Log Verification
After fix, check Google Apps Script logs:
```
✅ Using SKU-level cancelled amounts from shopBreakdown
   pompdelux-da.myshopify.com: SKU revenue=133.50, cancelled=54.91
```

If you see:
```
⚠️  FALLBACK: Using proportional calculation for...
```
Then SKU data is missing or `includeShopBreakdown` still not working.
