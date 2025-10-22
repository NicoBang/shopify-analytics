# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🧩 Project Context
This project syncs Shopify order and SKU data to Supabase for analytics and reporting. It replaces a legacy Google Apps Script solution with a modern Node.js/Supabase architecture, achieving 100x faster performance.

**Architecture:**
- Supabase Edge Functions (TypeScript/Deno runtime)
- Shopify Admin GraphQL Bulk Operations API
- PostgreSQL database with scheduled jobs (pg_cron + pg_net)

## 🆕 Recent Updates (October 2025)

### Session 1: Shipping and Freight Tracking (2025-10-12)
- ✅ **shipping_price_dkk**: Shipping cost EX VAT calculated from totalShippingPriceSet
- ✅ **shipping_refund_dkk**: Shipping refund EX VAT from order_adjustments
- ✅ **shipping_discount_dkk**: Shipping discount EX VAT via separate Edge Function
- ✅ **refund_date**: Timestamp for when shipping/order was refunded

### Session 2: VAT & Tax Rate Accuracy (2025-10-12)
- ✅ **tax_rate field**: Actual VAT rates from Shopify taxLines (25%, 19%, 21%)
- ✅ **Multi-currency VAT**: Different EU countries have different VAT rates
- ✅ **Accurate calculations**: All EX VAT conversions now use actual tax_rate
- ✅ **Historical backfill**: backfill-original-prices function for historical data

### Session 3: Multi-Currency Metadata (2025-10-12)
- ✅ **product_metadata_eur**: EUR shop prices (DE, NL, INT)
- ✅ **product_metadata_chf**: CHF shop prices
- ✅ **Cursor-based pagination**: Supports large product catalogs (>10,000 products)
- ✅ **Multi-currency analysis**: Compare sale prices and campaigns across currencies

### Session 4: Infrastructure (2025-10-12)
- ✅ **Stable production URL**: shopify-analytics-nu.vercel.app (no more preview URLs)
- ✅ **API consistency**: Changed last_updated to updated_at across all metadata APIs
- ✅ **Enhanced discount logic**: Improved sale_discount_per_unit_dkk calculation

### Session 5: Automated Failed Job Validation + Batch Processing Fix (2025-10-13)
- ✅ **Auto-validate system**: 100% automated validation of failed jobs
- ✅ **Empty day detection**: Distinguishes empty days from real failures via Shopify API
- ✅ **Cron automation**: Runs daily at 2 AM to clean up false failures
- ✅ **Multi-type support**: Validates orders, SKUs, refunds, and shipping-discounts automatically
- ✅ **Batch processing fix**: Fixed infinite loop bug - batch-sync-refunds now correctly advances through orders
- ✅ **Progress tracking**: Job ID is passed between iterations, allowing resume from last position
- ✅ **Large day support**: Can now sync 800+ order days without timeout (817 orders tested successfully)

### Session 6: Critical Discount & Currency Fixes (2025-10-15)
- ✅ **Duplikat aggregering fix**: Fixed `total_discount_dkk` calculation when same SKU appears multiple times in Shopify JSONL
  - **Bug**: Summed `total_discount_dkk` incorrectly (359.28 instead of 79.84)
  - **Fix**: Recalculate as `discount_per_unit_dkk × quantity` instead of summing

### Session 7: Analytics-v2 Revenue Calculation Fix (2025-10-20)
- ✅ **Bruttoomsætning fix**: Fixed `analytics-v2` Edge Function to calculate bruttoomsætning correctly
  - **Formula**: `bruttoomsætning = revenue_gross - total_discounts - cancelled_amount`
  - **Bug**: Previously used `revenue_gross` directly (4,153,957.41 kr instead of 3,717,977.45 kr)
  - **Fix**: Subtracts discounts and cancelled amounts from revenue_gross
- ✅ **Nettoomsætning fix**: Fixed nettoomsætning calculation to subtract returns from brutto
  - **Formula**: `nettoomsætning = bruttoomsætning - refundedAmount`
  - **Example**: 3,717,977.45 kr (brutto) - 391,666.34 kr (returns) = 3,326,311.11 kr (netto)
  - **Bug**: Previously used `revenue_net` from daily_shop_metrics
  - **Fix**: Calculate dynamically from bruttoomsætning minus refundedAmount
- ✅ **Currency conversion restoration**: Fixed missing EUR/CHF → DKK conversion in `updateOriginalPricesFromMetadata`
  - **Bug**: `original_price_dkk` showed 40.72 EUR instead of 303.77 DKK for INT shop
  - **Fix**: Added `currencyRate` multiplication: `(compareAtPrice × 7.46) / 1.25 = 303.77 DKK`
- ✅ **NULL validation**: Added `created_at` validation to prevent NULL constraint violations
- ✅ **Upsert → Update**: Changed `updateOriginalPricesFromMetadata` from upsert to UPDATE-only to avoid INSERT without required fields
- ✅ **Missing metadata**: Added 14 deleted SKUs to `product_metadata` with historical max prices
- ✅ **Shopify vs Database analysis**: Confirmed database is MORE CORRECT than Shopify Analytics (preserves deleted products)

**Critical Files Modified**:
- [supabase/functions/bulk-sync-skus/index.ts](supabase/functions/bulk-sync-skus/index.ts): All 5 bug fixes
- [legacy-sync-one-day.sh](legacy-sync-one-day.sh): Removed hardcoded Shopify token

### Session 8: Daily Metrics `omsaetning_net` Fix (2025-10-22) ⚠️ CRITICAL
- ✅ **CRITICAL FIX**: `omsaetning_net` in `daily_color_metrics` and `daily_sku_metrics` is **BRUTTO** revenue
  - **Formula**: `omsaetning_net = (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk`
  - **Does NOT subtract**: `refunded_amount` (stored separately in own column)
  - **Why**: Refunds happen on different dates than sales, must be tracked separately
- ✅ **Edge Function Fix**: Updated `color-analytics-v2` Edge Function to subtract `refunded_amount`
  - **Location**: `supabase/functions/color-analytics-v2/index.ts` (lines 272-286)
  - **Logic**: Sum `omsaetning_net` (brutto), then subtract `refunded_amount` to get net
- ✅ **Database Migrations**:
  - `20251022_fix_omsaetning_net_calculation.sql` - Fixed daily_color_metrics
  - `20251022_fix_sku_metrics_omsaetning.sql` - Fixed daily_sku_metrics

**🚨 NEVER ASSUME `omsaetning_net` is net revenue - it is BRUTTO!**
**🚨 ALWAYS subtract `refunded_amount` when calculating final revenue in Edge Functions!**

**Verification Example (2025-10-01, artikelnummer 100145):**
```
Sales (4 orders): 948.10 kr (after discounts, before refunds)
Refunds: 116.21 kr (from different date)
Expected omsaetning_net: 948.10 kr ✅
Expected net after refunds: 831.89 kr ✅
```

**Critical Files Modified**:
- [supabase/functions/color-analytics-v2/index.ts](supabase/functions/color-analytics-v2/index.ts): Lines 272-286
- [supabase/migrations/20251022_fix_omsaetning_net_calculation.sql](supabase/migrations/20251022_fix_omsaetning_net_calculation.sql)
- [supabase/migrations/20251022_fix_sku_metrics_omsaetning.sql](supabase/migrations/20251022_fix_sku_metrics_omsaetning.sql)

## 🗄️ Database Tables

### `orders` table
- Stores order-level data (totals, shipping, discounts)
- `created_at`: TIMESTAMPTZ (timezone-aware, Shopify order creation timestamp)
- **Shipping Fields (EX VAT):** `shipping_price_dkk`, `shipping_discount_dkk`, `shipping_refund_dkk`
- `refund_date`: TIMESTAMPTZ (when shipping/order was refunded)
- **`tax_rate`**: NUMERIC ✨ NEW (2025-10-12) - Actual VAT rate from Shopify taxLines (0.25 = 25%, 0.19 = 19%)
- Primary key: `(shop, order_id)`

### `skus` table
- Stores line item (SKU) level data with discount breakdown
- `created_at`: DATE (YYYY-MM-DD format, for filtering/grouping)
- `created_at_original`: TIMESTAMPTZ (preserves original Shopify order timestamp)
- **`tax_rate`**: NUMERIC ✨ NEW (2025-10-12) - VAT rate copied from parent order (0.25 = 25%)
- **`original_price_dkk`**: NUMERIC - List price before discounts (compareAtPrice from Shopify)
- **Discount Fields:**
  - `discount_per_unit_dkk` - Order-level discount allocated per unit
  - `sale_discount_per_unit_dkk` - Sale/campaign discount (original_price - selling_price)
  - `total_discount_dkk` - Total discount for line item
  - `sale_discount_total_dkk` - Total sale discount for line item
- Primary key: `(shop, order_id, sku)`

**CRITICAL: Date Filtering**
- ✅ ALWAYS filter `skus` by `created_at_original` (not `created_at`)
- ❌ `created_at` gets overwritten to sync date - DO NOT use for date ranges
- ✅ Use `created_at_original` for all period-based analytics

### `bulk_sync_jobs` table
- Job queue for orchestrator pattern
- Tracks sync progress: pending → running → completed/failed

### `product_metadata_eur` and `product_metadata_chf` tables ✨ NEW (2025-10-12)
- **Purpose:** Multi-currency product metadata for EUR and CHF shops
- **Tables:**
  - `product_metadata_eur`: DE, NL, INT shops (EUR prices INCL VAT)
  - `product_metadata_chf`: CHF shop (CHF prices INCL VAT)
- **Columns:**
  - `sku` (PRIMARY KEY)
  - `product_title`, `variant_title`
  - `price` (current selling price INCL VAT)
  - `compare_at_price` (list price / "før pris" INCL VAT)
  - `updated_at` (timestamp)
- **Use Case:** Support multi-currency price tracking and sale/campaign analysis
- **Sync:** Via `/api/sync-shop` endpoint with `type=metadata-eur` or `type=metadata-chf`
- **Migration:** `20251012_create_product_metadata_eur_chf.sql`

### `order_sequence_validation` table ✨ NEW (2025-10-11)
- **Purpose:** Data consistency validation - detect missing orders
- **Source:** Fetched directly from Shopify (separate from orders/skus sync)
- **Columns:**
  - `shop`, `shopify_order_number` (sequential 1,2,3...), `order_id`
  - `created_at` (Shopify order timestamp)
  - `exists_in_orders`, `exists_in_skus` (validation flags)
- **Use Case:** Find gaps in order sequences (e.g., missing order #847 when shop has #1-#1459)
- **Views:**
  - `order_sequence_gaps` - finds missing order numbers in sequence
  - `order_sequence_missing_data` - finds orders missing from orders/skus tables
- **Sync:** `./sync-order-sequences.sh [shop] [startDate] [endDate]`
- **Validation:** `./check-order-sequence.sh [shop]`

## 🔄 Sync Functions

### **bulk-sync-orders** ✅ FIXED (2025-10-11)
- **Purpose:** Syncs order-level data to `orders` table only
- **Method:** Shopify Bulk Operations API (GraphQL)
- **Does NOT write to `skus` table** (handled by bulk-sync-skus)
- **Fixed Issues:**
  - ✅ Removed `customer` and `billingAddress` fields (ACCESS_DENIED)
  - ✅ Changed from `current*` field names to standard names
  - ✅ Updated to match actual database schema
  - ✅ Now successfully syncs orders for all shops

### **bulk-sync-skus** ✅ CRITICAL FIXES (2025-10-15)
- **Purpose:** Syncs SKU/line item data to `skus` table
- **Method:** Shopify Bulk Operations API (GraphQL)
- **Status:** Production-ready with 5 critical fixes applied
- **Features:**
  - ✅ **Duplikat-aggregering** (prevents ON CONFLICT errors)
    - **FIXED (2025-10-15)**: Recalculates `total_discount_dkk = discount_per_unit_dkk × quantity` instead of summing
    - **Bug**: Previously summed duplicates causing 359.28 instead of 79.84
  - ✅ Sets `created_at_original` from Shopify order timestamp
    - **FIXED (2025-10-15)**: Added validation to catch invalid dates before processing
  - ✅ Calculates discount breakdown:
    - `discount_per_unit_dkk` (order-level discounts EX VAT)
    - `sale_discount_per_unit_dkk` (compareAtPrice - sellingPrice EX VAT)
    - `original_price_dkk` (compareAtPrice from Shopify EX VAT)
  - ✅ **Multi-currency support**:
    - **FIXED (2025-10-15)**: Restored EUR/CHF → DKK conversion in `updateOriginalPricesFromMetadata`
    - **Bug**: Missing `× currencyRate` multiplication (40.72 EUR instead of 303.77 DKK)
    - **Fix**: `(compareAtPrice × 7.46) / 1.25 = correct DKK EX VAT`
  - ✅ **Metadata updates**:
    - **FIXED (2025-10-15)**: Changed from `upsert` to `UPDATE`-only to prevent NULL constraint violations
  - ✅ Handles cancelled_qty/cancelled_amount_dkk (set to 0, updated by bulk-sync-refunds)
  - ✅ No ACCESS_DENIED issues (doesn't query customer/billingAddress)

**Critical Sections**:
- Lines 887-913: Duplikat aggregering with fixed recalculation
- Lines 815-829: created_at validation
- Lines 959-977: Multi-currency metadata table selection
- Lines 1058-1064: Currency conversion with `× currencyRate`
- Lines 1076-1094: UPDATE-only metadata sync

### **bulk-sync-refunds** ✅ ENHANCED (October 2025)
- **Purpose:** Updates SKU refund/cancellation data + shipping refunds
- **SKU Updates:** `refunded_qty`, `refunded_amount_dkk`, `cancelled_qty`, `cancelled_amount_dkk`, `refund_date`
- **Order Updates:** `shipping_refund_dkk`, `refund_date` (from order_adjustments array)
- **Does NOT overwrite:** discount fields, created_at_original, or other SKU data
- **Method:** REST API `/orders/{order_id}/refunds.json` with `order_adjustments` parsing

### **bulk-sync-shipping-discounts** ✨ NEW (October 2025)
- **Purpose:** Syncs shipping discount data (free shipping campaigns)
- **Updates:** `shipping_discount_dkk` in orders table (EX VAT)
- **Method:** GraphQL API per order to fetch `shippingLines` data
- **Process:**
  1. Queries orders with `shipping > 0`
  2. Fetches `shippingLines` (originalPrice - discountedPrice)
  3. Converts INCL VAT to EX VAT using tax_rate
  4. Updates orders table
- **Rate Limiting:** 500ms delay between API calls
- **Manual Sync:** See deployment section in "Shipping and Freight Tracking"

### **bulk-sync-orchestrator**
- **Purpose:** Creates daily sync jobs in `bulk_sync_jobs` table
- **Limitation:** May timeout on large date ranges (>7 days) - this is OK
- **Jobs persist in database** with status='pending' for later processing

### **continue-orchestrator**
- **Purpose:** Processes pending jobs incrementally (20 jobs per run)
- **Stateless:** Can be called repeatedly until all jobs complete
- **Auto-scheduled:** Runs every 5 minutes via pg_cron

### **watchdog**
- **Purpose:** Cleans up stale jobs stuck in "running" status (>2 minutes)
- **Auto-scheduled:** Runs every minute via pg_cron

### **auto-validate-failed-jobs** ✨ NEW (2025-10-13)
- **Purpose:** 100% automated validation of failed jobs
- **Method:** Checks Shopify API to verify if data existed on failed job dates
- **Actions:**
  - Marks empty days as completed (not real failures)
  - Preserves real failures for manual attention
- **Coverage:** Validates orders, SKUs, and refunds
- **Auto-scheduled:** Runs daily at 2 AM via pg_cron
- **Manual:** `./test-auto-validate.sh`
- **Deploy:** `npx supabase functions deploy auto-validate-failed-jobs --no-verify-jwt`

### **validate-failed-jobs** ✨ NEW (2025-10-13)
- **Purpose:** Core validation function called by auto-validate-failed-jobs
- **Method:** Shopify REST API order count check per date
- **Returns:** Summary of empty days corrected and real failures remaining
- **Deploy:** `npx supabase functions deploy validate-failed-jobs --no-verify-jwt`

### **sync-order-sequences** ✨ NEW (2025-10-11)
- **Purpose:** Fetch order sequence numbers from Shopify for validation
- **Data:** `shop`, `orderNumber` (1,2,3...), `order_id`, `createdAt`
- **Writes to:** `order_sequence_validation` table
- **Use:** Detect missing orders by comparing against orders/skus tables
- **Manual:** `./sync-order-sequences.sh [shop] [startDate] [endDate]`
- **Deploy:** `npx supabase functions deploy sync-order-sequences --no-verify-jwt`

## 💰 VAT and Tax Rate Handling ✨ NEW (2025-10-12)

### Overview
The system now tracks actual VAT rates from Shopify for accurate EX VAT calculations. Previously used hardcoded 0.25 (25%) for all calculations.

### Implementation

**`tax_rate` Field (orders and skus tables):**
- Stores actual VAT rate from Shopify `taxLines` data
- Format: Decimal (0.25 = 25%, 0.19 = 19%, 0.21 = 21%)
- Source: First taxLine rate from Shopify order data
- Fallback: 0.25 if no taxLines present

**bulk-sync-orders:**
```typescript
// Extract actual tax rate from taxLines
const taxLinesData = order.taxLines?.edges || [];
let actualTaxRate = null;
if (taxLinesData.length > 0) {
  actualTaxRate = parseFloat(taxLinesData[0].node.rate || "0");
}

// Store in orders table
const orderRecord = {
  // ... other fields
  tax_rate: actualTaxRate || 0.25,  // Store actual rate or fallback
};
```

**bulk-sync-skus:**
```typescript
// Copy tax_rate from parent order for accurate EX VAT calculations
const skuRecord = {
  // ... other fields
  tax_rate: order.tax_rate || 0.25,
};

// Use tax_rate for all EX VAT conversions
const priceExVat = priceInclVat / (1 + tax_rate);
```

### Benefits

1. **Accurate Multi-Currency VAT**: Different EU countries have different VAT rates (DK: 25%, DE: 19%, NL: 21%)
2. **Correct Historical Data**: No longer assumes all orders had 25% VAT
3. **Future-Proof**: Supports VAT rate changes without code modifications
4. **Shipping Calculations**: Uses correct tax_rate for shipping EX VAT conversions

### Migration

**Database Migration:** `20251012_add_tax_rate_columns.sql`
- Adds `tax_rate` column to orders table (with comment)
- Adds `tax_rate` column to skus table (with index)
- Historical data requires backfill (see backfill-original-prices function)

**Backfill Function:** `supabase/functions/backfill-original-prices/index.ts`
- Fetches historical orders from Shopify
- Extracts taxLines data and original prices
- Updates orders and skus tables with accurate tax_rate values

### Usage Example

```sql
-- Calculate total revenue EX VAT using actual tax_rate
SELECT
  shop,
  SUM(total_dkk / (1 + tax_rate)) as total_ex_vat,
  AVG(tax_rate) as avg_tax_rate
FROM orders
WHERE created_at >= '2025-01-01'
GROUP BY shop;
```

## 🌍 Multi-Currency Product Metadata ✨ NEW (2025-10-12)

### Overview
The system now supports separate product metadata tables for EUR and CHF currencies, enabling multi-currency price tracking and sale/campaign analysis.

### Architecture

**Three Metadata Tables:**
1. **`product_metadata`** (DKK): Danish shop prices in DKK
2. **`product_metadata_eur`** ✨ NEW: DE, NL, INT shop prices in EUR
3. **`product_metadata_chf`** ✨ NEW: CHF shop prices in CHF

**All prices stored INCL VAT**

### Implementation

**Database Tables:**
```sql
CREATE TABLE product_metadata_eur (
  sku TEXT PRIMARY KEY,
  product_title TEXT,
  variant_title TEXT,
  price NUMERIC,  -- EUR price INCL VAT
  compare_at_price NUMERIC,  -- EUR "before sale" price INCL VAT
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Sync via API:**
```bash
# Sync EUR metadata (DE, NL, INT shops)
curl "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=pompdelux-de.myshopify.com&type=metadata-eur"

# Sync CHF metadata (CHF shop)
curl "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=pompdelux-chf.myshopify.com&type=metadata-chf"
```

**Cursor-Based Pagination:**
- Supports large product catalogs (>10,000 products)
- Fetches 250 products per page
- No timeout issues with incremental pagination

### Use Cases

1. **Multi-Currency Sale Analysis:**
```sql
-- Compare sale prices across currencies
SELECT
  pm_dkk.sku,
  pm_dkk.price as price_dkk,
  pm_eur.price as price_eur,
  pm_chf.price as price_chf,
  pm_dkk.compare_at_price as original_dkk,
  pm_eur.compare_at_price as original_eur
FROM product_metadata pm_dkk
LEFT JOIN product_metadata_eur pm_eur ON pm_dkk.sku = pm_eur.sku
LEFT JOIN product_metadata_chf pm_chf ON pm_dkk.sku = pm_chf.sku
WHERE pm_dkk.compare_at_price > pm_dkk.price;
```

2. **Currency-Specific Campaign Tracking:**
```sql
-- Find products on sale in EUR shops but not in DKK shop
SELECT
  pm_eur.sku,
  pm_eur.product_title,
  pm_eur.price as sale_price_eur,
  pm_eur.compare_at_price as original_eur,
  ((pm_eur.compare_at_price - pm_eur.price) / pm_eur.compare_at_price * 100) as discount_pct
FROM product_metadata_eur pm_eur
LEFT JOIN product_metadata pm_dkk ON pm_eur.sku = pm_dkk.sku
WHERE pm_eur.compare_at_price > pm_eur.price
  AND (pm_dkk.compare_at_price IS NULL OR pm_dkk.compare_at_price = pm_dkk.price);
```

### Migration

**Database Migration:** `20251012_create_product_metadata_eur_chf.sql`
- Creates `product_metadata_eur` table
- Creates `product_metadata_chf` table
- Adds indexes and comments
- No data migration needed (fresh tables)

**API Changes:**
- `api/sync-shop.js`: Added `metadata-eur` and `metadata-chf` sync types
- `api/metadata.js`: Changed `last_updated` field to `updated_at` for consistency

### Helper Scripts

```bash
# Paginated metadata sync (supports large catalogs)
./sync-metadata-paginated.sh pompdelux-de.myshopify.com eur
./sync-metadata-paginated.sh pompdelux-chf.myshopify.com chf

# Legacy single-page sync (for small catalogs)
./sync-metadata.sh pompdelux-da.myshopify.com
```

## 📊 Revenue Calculation Logic ✨ UPDATED (2025-10-20)

### Dashboard_2_0 Revenue Formulas

**Critical: These calculations are performed in `analytics-v2` Edge Function**

**Bruttoomsætning (Gross Revenue after discounts and cancellations):**
```typescript
bruttoomsætning = revenue_gross - total_discounts - cancelled_amount
```
- **Example:** 4,153,957.41 - 425,783.61 - 10,196.35 = **3,717,977.45 kr** ✅
- **Source:** `daily_shop_metrics` table
- **Location:** [analytics-v2/index.ts:145](supabase/functions/analytics-v2/index.ts#L145)

**Nettoomsætning (Net Revenue after returns):**
```typescript
nettoomsætning = bruttoomsætning - refundedAmount
```
- **Example:** 3,717,977.45 - 391,666.34 = **3,326,311.11 kr** ✅
- **Source:** Calculated from aggregated metrics
- **Location:** [analytics-v2/index.ts:154](supabase/functions/analytics-v2/index.ts#L154)

**Important Notes:**
- ❌ **DO NOT** use `revenue_net` from `daily_shop_metrics` - it has wrong calculation
- ✅ **DO** calculate `nettoomsætning` dynamically from `bruttoomsætning - refundedAmount`
- ✅ Edge Function performs all revenue calculations client-side for correct aggregation

### Discount Breakdown

**Dashboard "Rabat ex moms" = Order Discounts + Sale Discounts**

### Order-Level Discounts
- Applied to entire order (discount codes, automatic discounts)
- Stored in: `discount_per_unit_dkk`, `total_discount_dkk`
- **CRITICAL FIX (2025-10-15)**: `total_discount_dkk` now **recalculates** instead of summing duplicates
  - **Bug**: When same SKU appeared multiple times in Shopify JSONL, summed incorrectly (359.28 instead of 79.84)
  - **Fix**: `total_discount_dkk = discount_per_unit_dkk × quantity`
  - **Location**: [bulk-sync-skus/index.ts:903](supabase/functions/bulk-sync-skus/index.ts#L903)

### Sale/Campaign Discounts
- Difference between original price and discounted selling price
- Stored in: `sale_discount_per_unit_dkk`, `sale_discount_total_dkk`
- `original_price_dkk` = MAX(originalUnitPrice, compareAtPrice)

**Shopify Price Logic:**
- When item is NOT on sale: `price` = 679, `compareAtPrice` = 0
- When item IS on sale: `price` = 203.70, `compareAtPrice` = 679
- Therefore: `original_price_dkk` = MAX(originalUnitPrice, compareAtPrice)
- Sale discount = original_price - discounted_price

**CRITICAL FIXES (October 2025):**
- Previously used `compareAtPrice - originalPrice` (wrong - both are same when on sale)
- Now correctly uses `MAX(originalPrice, compareAtPrice) - discountedPrice`
- Dashboard API must SELECT both `discount_per_unit_dkk` AND `sale_discount_per_unit_dkk`
- **Multi-currency fix (2025-10-15)**: Restored `× currencyRate` for EUR/CHF shops in metadata updates
  - **Bug**: EUR prices not converted to DKK (40.72 EUR instead of 303.77 DKK)
  - **Fix**: `(compareAtPrice × 7.46) / 1.25 = correct DKK EX VAT`
  - **Location**: [bulk-sync-skus/index.ts:1058-1064](supabase/functions/bulk-sync-skus/index.ts#L1058-L1064)

## 🚢 Shipping and Freight Tracking ✨ NEW (October 2025)

### Overview
The system tracks three separate shipping-related fields in the `orders` table, all stored as EX VAT (excluding VAT) in DKK:
- **`shipping_price_dkk`**: Shipping cost paid by customer (EX VAT)
- **`shipping_discount_dkk`**: Shipping discount applied (EX VAT, e.g., free shipping campaigns)
- **`shipping_refund_dkk`**: Shipping refund given to customer (EX VAT)
- **`refund_date`**: When shipping was refunded (TIMESTAMPTZ)

### Implementation Details

#### 1. shipping_price_dkk (bulk-sync-orders)
**Challenge:** Shopify Bulk Operations API does NOT export nested `shippingLines` data in JSONL format.

**Solution:** Calculate from `totalShippingPriceSet` (INCL VAT) by converting to EX VAT:
```typescript
if (shipping > 0) {
  const shippingTaxRate = actualTaxRate || taxRate;
  shippingPriceDkk = shipping / (1 + shippingTaxRate);
}
```

**Example:**
- Order 7781771116878: `totalShippingPriceSet` = 39.00 DKK INCL VAT
- Tax rate: 0.25 (25%)
- `shipping_price_dkk` = 39.00 / 1.25 = **31.20 DKK EX VAT** ✅

#### 2. shipping_refund_dkk + refund_date (bulk-sync-refunds)
**Discovery:** Shopify REST API refunds endpoint has `order_adjustments` array with `kind: "shipping_refund"`.

**Implementation:** Parse `order_adjustments` in bulk-sync-refunds:
```typescript
for (const adj of orderAdjustments) {
  if (adj.kind === "shipping_refund") {
    // amount is negative for refunds (e.g. -31.20 DKK EX VAT)
    const shippingRefundDkk = Math.abs(parseFloat(adj.amount || "0"));
    const currency = adj.amount_set?.shop_money?.currency_code || "DKK";
    const rate = CURRENCY_RATES[currency] || 1;
    const shippingRefundDkkConverted = shippingRefundDkk * rate;

    // Track both shipping_refund_dkk and refund_date
    orderUpdates.set(cleanOrderId, {
      shipping_refund_dkk: shippingRefundDkkConverted,
      refund_date: refundDate
    });
  }
}
```

**Example:**
- Order 7781771116878:
  - `shipping_refund_dkk` = **31.20 DKK EX VAT** ✅
  - `refund_date` = **2025-09-08T15:20:21+00:00** ✅

#### 3. shipping_discount_dkk (bulk-sync-shipping-discounts)
**Challenge:** Cannot calculate from Bulk API - requires `shippingLines` data with original vs. discounted price.

**Solution:** Created separate Edge Function that:
1. Queries `orders` table for orders with `shipping > 0`
2. Fetches `shippingLines` data via GraphQL API per order:
```typescript
const query = `{
  order(id: "gid://shopify/Order/${orderId}") {
    shippingLines(first: 5) {
      edges {
        node {
          originalPriceSet { shopMoney { amount currencyCode } }
          discountedPriceSet { shopMoney { amount currencyCode } }
          taxLines { rate }
        }
      }
    }
  }
}`;
```
3. Calculates discount: `originalPrice - discountedPrice` (INCL VAT)
4. Converts to EX VAT using tax_rate from database
5. Updates `orders` table with `shipping_discount_dkk`

**Example:**
- Order 7857151082830 (free shipping):
  - `originalPriceSet` = 39.00 DKK INCL VAT
  - `discountedPriceSet` = 0.00 DKK INCL VAT
  - Tax rate: 0.25 (25%)
  - `shipping_discount_dkk` = (39.00 - 0.00) / 1.25 = **31.20 DKK EX VAT** ✅

### Shopify API Limitations

**Why Three Separate Functions?**

1. **bulk-sync-orders**: Uses Bulk Operations API (JSONL) which does NOT export nested `shippingLines` data. Can only calculate `shipping_price_dkk` from `totalShippingPriceSet`.

2. **bulk-sync-refunds**: Uses REST API `/orders/{order_id}/refunds.json` which has `order_adjustments` array for tracking `shipping_refund_dkk`.

3. **bulk-sync-shipping-discounts**: Uses GraphQL API per order to fetch `shippingLines` data with original vs. discounted prices.

### Usage Examples

**Query orders with shipping cost:**
```typescript
const { data } = await supabase
  .from("orders")
  .select("order_id, shipping_price_dkk, shipping_discount_dkk, shipping_refund_dkk, refund_date")
  .gt("shipping", 0)
  .gte("created_at", "2025-09-01T00:00:00Z")
  .lte("created_at", "2025-09-30T23:59:59Z");
```

**Calculate total shipping revenue (net):**
```sql
SELECT
  SUM(shipping_price_dkk) as total_shipping_charged,
  SUM(shipping_discount_dkk) as total_shipping_discounts,
  SUM(shipping_refund_dkk) as total_shipping_refunded,
  SUM(shipping_price_dkk - shipping_discount_dkk - shipping_refund_dkk) as net_shipping_revenue
FROM orders
WHERE created_at >= '2025-09-01'
  AND created_at <= '2025-09-30';
```

### Deployment

```bash
# Deploy shipping functions
npx supabase functions deploy bulk-sync-orders --no-verify-jwt
npx supabase functions deploy bulk-sync-refunds --no-verify-jwt
npx supabase functions deploy bulk-sync-shipping-discounts --no-verify-jwt

# Sync shipping data for date range
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-shipping-discounts" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-09-01",
    "endDate": "2025-09-30"
  }'
```

### Files Modified

1. **`supabase/functions/bulk-sync-orders/index.ts`**: Added `shipping_price_dkk` calculation
2. **`supabase/functions/bulk-sync-refunds/index.ts`**: Added `shipping_refund_dkk` and `refund_date` tracking
3. **`supabase/functions/bulk-sync-shipping-discounts/index.ts`**: NEW function for shipping discount tracking
4. **`supabase/functions/_shared/types.ts`**: Added `shipping_price_dkk` and `shipping_discount_dkk` to OrderRecord interface

### Testing & Verification

**Test orders:**
- Order 7781771116878 (2025-08-30): Paid 39 DKK shipping → refunded 31.20 DKK EX VAT on 2025-09-08
- Order 7857151082830 (2025-10-05): Free shipping discount 31.20 DKK EX VAT

**Verification query:**
```sql
SELECT
  order_id,
  name,
  shipping,
  shipping_price_dkk,
  shipping_discount_dkk,
  shipping_refund_dkk,
  refund_date
FROM orders
WHERE order_id IN ('7781771116878', '7857151082830')
ORDER BY order_id;
```

## 🧭 Date and Timestamp Handling Rules

### skus table
- `created_at` → **DATE** (YYYY-MM-DD, no timezone)
- `created_at_original` → **TIMESTAMPTZ** (full Shopify timestamp)
- **ALWAYS filter by `created_at_original`** for date ranges
- Example:
  ```typescript
  .gte("created_at_original", "2025-09-01T00:00:00Z")
  .lte("created_at_original", "2025-09-30T23:59:59Z")
  ```

### orders table
- `created_at` → **TIMESTAMPTZ** (timezone-aware)
- Use full ISO timestamp for filtering:
  ```typescript
  .gte("created_at", "2025-09-01T00:00:00Z")
  .lte("created_at", "2025-09-30T23:59:59Z")
  ```

## 🚨 CRITICAL: Google Sheets Timezone Conversion (READ THIS FIRST!)

**⚠️ THIS HAS BEEN BROKEN 5-7 TIMES - NEVER REMOVE THIS LOGIC AGAIN! ⚠️**

### The Problem
Google Sheets sends dates via `formatDateWithTime()` which **subtracts** timezone offset to convert Danish dates to UTC:
```javascript
// Google Sheets: google-sheets-enhanced.js line 1463-1485
function formatDateWithTime(date, isEndDate = false) {
  const isDST = isDanishDST_(year, month + 1, day);
  const offset = isDST ? 2 : 1;  // 2 hours in summer, 1 in winter

  if (isEndDate) {
    utcDate.setUTCHours(24 - offset, 0, 0, 0);  // 24-2=22:00 (summer) or 23:00 (winter)
  } else {
    utcDate.setUTCHours(0 - offset, 0, 0, 0);   // 0-2=-2=22:00 previous day (summer)
  }
}
```

**Example:**
- Danish date: `09/09/2025` (user input)
- Google Sheets sends: `2025-09-08T22:00:00Z` (summer) or `2025-09-08T23:00:00Z` (winter)
- **This is 22:00 the PREVIOUS DAY in UTC!**

### The Solution (MANDATORY in ALL Edge Functions)
Edge Functions **MUST** add the offset back to get correct Danish date:

```typescript
// ✅ CORRECT - DO NOT REMOVE THIS CODE!
function isDanishSummerTime(utcTimestamp: Date): boolean {
  const date = new Date(utcTimestamp);
  const year = date.getUTCFullYear();

  const marchLastDay = new Date(Date.UTC(year, 2, 31, 1, 0, 0));
  const marchLastSunday = new Date(marchLastDay);
  marchLastSunday.setUTCDate(31 - marchLastDay.getUTCDay());

  const octoberLastDay = new Date(Date.UTC(year, 9, 31, 1, 0, 0));
  const octoberLastSunday = new Date(octoberLastDay);
  octoberLastSunday.setUTCDate(31 - octoberLastDay.getUTCDay());

  return date >= marchLastSunday && date < octoberLastSunday;
}

// Extract Danish calendar date by adding correct offset
const startOffset = isDanishSummerTime(startDate) ? 2 : 1;
const endOffset = isDanishSummerTime(endDate) ? 2 : 1;

const dateStart = new Date(startDate.getTime() + startOffset * 60 * 60 * 1000).toISOString().split('T')[0];
const dateEnd = new Date(endDate.getTime() + endOffset * 60 * 60 * 1000).toISOString().split('T')[0];
```

**Why this works:**
- Google sends: `2025-09-08T22:00:00Z`
- Add 2 hours (summer): `2025-09-09T00:00:00Z`
- Extract date: `2025-09-09` ✅ CORRECT!

### Common Mistakes (NEVER DO THIS!)
❌ **WRONG**: `startDate.toISOString().split('T')[0]` → Returns `2025-09-08` (previous day!)
❌ **WRONG**: Removing timezone offset logic → Breaks all date filtering
❌ **WRONG**: "daily_*_metrics already has Danish dates, no conversion needed" → IGNORES that Google Sheets sends UTC timestamps!

### Where This Logic is Required
- ✅ `color-analytics-v2/index.ts` (lines 17-42)
- ✅ `sku-analytics-v2/index.ts` (lines 17-42)
- ✅ Any future Edge Function that receives dates from Google Sheets

### Testing
Always test with a specific date range like `09/09/2025 to 19/10/2025`:
- Check that `dateStart` = `2025-09-09` (not `2025-09-08`)
- Check that `dateEnd` = `2025-10-19` (not `2025-10-18`)
- Verify total sales match database query for same date range

## 🛠️ Development Commands

### Testing
```bash
# Run all tests
npm test

# Run reconciliation tests (analytics accuracy)
npm run test:reconciliation

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage

# Test specific functionality
node src/test-complete.js              # Full system test
node src/test-fetch-orders.js         # Test order fetching
node src/test-config.js               # Test configuration
```

### Sync Operations
```bash
# Complete sync for date range (BOTH orders AND SKUs)
./sync-complete.sh 2025-10-01 2025-10-07

# Large backfill (>7 days) - use incremental job creation
./create-all-jobs.sh 2025-08-01 2025-09-30
./check-sync-status.sh 2025-08-01 2025-09-30

# Smart incremental sync (auto-detects missing data)
./smart-incremental-sync.sh 2024-09-30 2025-10-10

# Fix failed syncs
./fix-failed-sku-sync.sh
./retry-failed-jobs.sh

# Order sequence validation (detect missing orders)
./sync-order-sequences.sh [shop] [startDate] [endDate]
./check-order-sequence.sh [shop]
```

### Monitoring & Status
```bash
# Check sync job status
./check-sync-status.sh 2025-08-01 2025-09-30
./real-status.sh                      # Real-time status
./live-sync-monitor.sh                # Live monitoring

# Test watchdog (cleanup stale jobs)
./test-watchdog.sh

# Manual cleanup
./cleanup-stale-jobs.sh
```

### Deployment
```bash
# Deploy Edge Function
npx supabase functions deploy <function-name> --no-verify-jwt

# Deploy smart sync functions
./deploy-smart-sync.sh
```

## ⚙️ Development Style
- Keep answers concise and focused
- No session history summaries or context reconstruction
- Each task is self-contained
- If ambiguous, ask a single clarifying question
- **IMPORTANT:** When providing SQL for user to run manually, ALWAYS output raw SQL in code block (never use mcp__supabase__execute_sql which times out)

## 🧱 Technical Stack
- **Runtime:** Deno (Supabase Edge Functions)
- **API:** Shopify Admin GraphQL Bulk Operations API
- **Database:** Supabase (PostgreSQL)
- **Language:** TypeScript (Edge Functions), JavaScript (Vercel API)
- **Scheduling:** pg_cron + pg_net extensions
- **Testing:** Jest with 30-second timeout for API calls

## 🏗️ High-Level Architecture

### Data Flow
1. **Shopify → Edge Functions**: Bulk Operations API fetches order/SKU data in parallel
2. **Edge Functions → Database**: Upserts to PostgreSQL with conflict resolution
3. **Orchestrator Pattern**: Job queue prevents timeouts on large operations
4. **Cron Jobs**: Automated processing via pg_cron + pg_net
5. **API → Google Sheets**: Vercel endpoints serve analytics data

### Key Design Decisions
- **Bulk Operations API**: Handles millions of records without timeout
- **Job Queue Pattern**: Breaks large syncs into manageable chunks
- **Duplicate Aggregation**: Prevents conflicts by pre-aggregating SKU duplicates
- **Separate Tables**: Orders and SKUs in different tables for performance
- **Smart Sync**: Auto-detects and fills missing data gaps
- **Order Sequence Validation**: Independent data source from Shopify to detect missing orders

### Multi-Shop Support
The system handles 5 Shopify shops with automatic currency conversion:
- 🇩🇰 `pompdelux-da.myshopify.com` (DKK)
- 🇩🇪 `pompdelux-de.myshopify.com` (EUR → DKK)
- 🇳🇱 `pompdelux-nl.myshopify.com` (EUR → DKK)
- 🌍 `pompdelux-int.myshopify.com` (EUR → DKK)
- 🇨🇭 `pompdelux-chf.myshopify.com` (CHF → DKK)

### Production URLs
**Vercel API:** `https://shopify-analytics-nu.vercel.app` ✨ STABLE (2025-10-12)
- Previously: `shopify-analytics-*-nicolais-projects-291e9559.vercel.app` (changed with each deployment)
- Now: Stable production URL that doesn't change between deployments
- Updated in all scripts, documentation, and configuration files (32 occurrences)

### Environment Variables Required
```bash
# Supabase
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Service role key for Edge Functions
SERVICE_ROLE_KEY=eyJ...            # Alternative name for same key

# Shopify (one token per shop)
SHOPIFY_TOKEN_DA=shpat_...
SHOPIFY_TOKEN_DE=shpat_...
SHOPIFY_TOKEN_NL=shpat_...
SHOPIFY_TOKEN_INT=shpat_...
SHOPIFY_TOKEN_CHF=shpat_...
```

## 🔄 Orchestration Pattern for Large Backfills

**Problem:** Edge Functions timeout after ~6-7 minutes

**Solution:** Two-step incremental processing

### Step 1: Create Jobs
```bash
./restart-orchestrator.sh  # Creates pending jobs (may timeout - OK)
```

### Step 2: Process Jobs
Jobs are automatically processed by cron job every 5 minutes:
```sql
SELECT cron.schedule(
  'auto-continue-orchestrator',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Or manually:
```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{}'
```

### Step 3: Check Status
```bash
./check-sync-status.sh 2025-08-01 2025-09-30
```

## 🛡️ Watchdog Protection

Cleans up stale jobs every minute:
```sql
SELECT cron.schedule(
  'watchdog-cleanup',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Requirements:** Both `pg_cron` AND `pg_net` extensions must be enabled.

## 🛠️ Common Issues

### Watchdog Cron Job Not Running
**Symptom:** Jobs stuck as "running"

**Cause:** Missing `pg_net` extension

**Solution:**
1. Supabase Dashboard → Database → Extensions
2. Enable `pg_net` extension
3. Verify: `SELECT * FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`

### Orchestrator Timeout
**Symptom:** Timeout after 6-7 minutes

**Cause:** Edge Function hard limit

**Solution:** Use two-step orchestration pattern (see above)

### Dashboard Shows Wrong Discount Amount
**Symptom:** "Rabat ex moms" too low or too high

**Root Causes:**
1. ❌ Dashboard API not fetching `sale_discount_per_unit_dkk` field
2. ❌ Filtering by `created_at` instead of `created_at_original`
3. ❌ bulk-sync-skus using wrong price field (originalPrice vs compareAtPrice)

**Solution:**
1. ✅ Dashboard must SELECT both discount fields
2. ✅ ALWAYS filter SKUs by `created_at_original`
3. ✅ bulk-sync-skus must use `compareAtPrice` for sale discount calculation

### Incorrect Discount Values (359.28 instead of 79.84) ✨ FIXED (2025-10-15)
**Symptom:** `discount_per_unit_dkk` and `total_discount_dkk` showing same incorrect value (e.g., 359.28)

**Root Cause:** Duplikat aggregering summed `total_discount_dkk` when same SKU appeared multiple times in Shopify JSONL

**Solution:**
- ✅ FIXED in [bulk-sync-skus/index.ts:903](supabase/functions/bulk-sync-skus/index.ts#L903)
- Now recalculates: `total_discount_dkk = discount_per_unit_dkk × quantity`
- Resync affected dates to fix historical data

### EUR/CHF Prices Not Converting to DKK ✨ FIXED (2025-10-15)
**Symptom:** `original_price_dkk` showing EUR/CHF value instead of DKK (e.g., 40.72 instead of 303.77)

**Root Cause:** `updateOriginalPricesFromMetadata` missing `× currencyRate` multiplication

**Solution:**
- ✅ FIXED in [bulk-sync-skus/index.ts:1058-1064](supabase/functions/bulk-sync-skus/index.ts#L1058-L1064)
- Now calculates: `(compareAtPrice × 7.46) / 1.25 = correct DKK EX VAT`
- Resync EUR/CHF shop orders to fix historical data

### NULL created_at Constraint Violation ✨ FIXED (2025-10-15)
**Symptom:** `ERROR: null value in column "created_at" of relation "skus" violates not-null constraint`

**Root Causes:**
1. ❌ Invalid Shopify dates not validated before processing
2. ❌ `updateOriginalPricesFromMetadata` tried to INSERT new rows without `created_at`

**Solution:**
1. ✅ FIXED: Added date validation in [bulk-sync-skus/index.ts:815-829](supabase/functions/bulk-sync-skus/index.ts#L815-L829)
2. ✅ FIXED: Changed from `upsert` to `UPDATE`-only in [bulk-sync-skus/index.ts:1076-1094](supabase/functions/bulk-sync-skus/index.ts#L1076-L1094)

### Dollar-Quoted String Syntax Error
**Symptom:** `ERROR: 42601: syntax error at or near "$"`

**Cause:** Single `$` instead of `$$` in PostgreSQL

**Solution:** Use `$$` to delimit function body in cron jobs

## 📚 Key Files

### Edge Functions
- `supabase/functions/bulk-sync-orders/index.ts` - Order sync (orders table only, includes shipping_price_dkk and tax_rate)
- `supabase/functions/bulk-sync-skus/index.ts` - SKU sync (skus table with full discount logic and tax_rate)
- `supabase/functions/bulk-sync-refunds/index.ts` - Refund/cancellation updates (includes shipping_refund_dkk and refund_date)
- `supabase/functions/bulk-sync-shipping-discounts/index.ts` - Shipping discount sync (shipping_discount_dkk) ✨ NEW
- `supabase/functions/backfill-original-prices/index.ts` - Historical tax_rate and original_price backfill ✨ NEW
- `supabase/functions/bulk-sync-orchestrator/index.ts` - Job creator
- `supabase/functions/continue-orchestrator/index.ts` - Job processor (processes 20 jobs per run)
- `supabase/functions/watchdog/index.ts` - Stale job cleanup
- `supabase/functions/smart-order-sync/index.ts` - Smart incremental order sync
- `supabase/functions/smart-sku-sync/index.ts` - Smart incremental SKU sync

### API Endpoints (Vercel)
- `api/analytics.js` - Main analytics API (dashboard data)
- `api/metadata.js` - Product metadata API (updated_at field) ✨ UPDATED (2025-10-12)
- `api/sync-shop.js` - Shop sync API (includes metadata-eur, metadata-chf types) ✨ UPDATED (2025-10-12)
- `api/fulfillments.js` - Delivery analytics API

**Base URL:** `https://shopify-analytics-nu.vercel.app`

### Helper Scripts
- **Sync Scripts:**
  - `sync-complete.sh` - Complete sync for date range (recommended)
  - `smart-incremental-sync.sh` - Auto-detect and fill gaps
  - `create-all-jobs.sh` - Create jobs for large backfills
  - `sync-metadata-paginated.sh` - Multi-currency metadata sync with pagination ✨ NEW

- **Monitoring:**
  - `check-sync-status.sh` - Check job status
  - `real-status.sh` - Real-time status
  - `live-sync-monitor.sh` - Continuous monitoring

- **Recovery:**
  - `fix-failed-sku-sync.sh` - Fix failed SKU syncs
  - `retry-failed-jobs.sh` - Retry all failed jobs
  - `cleanup-stale-jobs.sh` - Manual cleanup

### Test Files
- `tests/analytics/reconciliation.test.js` - Data accuracy tests
- `tests/setup.js` - Test environment configuration
- `src/test-complete.js` - Full system test
- `src/test-fetch-orders.js` - Order fetching test

### Documentation
- `SYNC-MANUAL.md` - Complete sync workflow guide (Danish)
- `README.md` - Project overview and migration guide
- `DEPLOYMENT.md` - Deployment instructions

## 🎯 Critical Rules

1. **Date Filtering:** ALWAYS use `created_at_original` for SKU date ranges
2. **Discount Fields:** Dashboard must SELECT both `discount_per_unit_dkk` AND `sale_discount_per_unit_dkk`
3. **Price Fields:** bulk-sync-skus uses `compareAtPrice` (not `originalUnitPriceSet`) for sale discounts
4. **Shipping Fields:** All shipping fields stored as EX VAT (excluding VAT) in DKK
   - `shipping_price_dkk` = calculated from totalShippingPriceSet / (1 + tax_rate)
   - `shipping_discount_dkk` = requires GraphQL query per order (separate function)
   - `shipping_refund_dkk` = parsed from order_adjustments in refunds API
5. **Duplikater (2025-10-15 FIXED):** bulk-sync-skus aggregates duplicates AND recalculates `total_discount_dkk`
   - **NEVER sum** `total_discount_dkk` from duplicates
   - **ALWAYS recalculate**: `total_discount_dkk = discount_per_unit_dkk × quantity`
6. **Multi-Currency (2025-10-15 FIXED):** ALWAYS multiply by `currencyRate` in `updateOriginalPricesFromMetadata`
   - **Formula**: `(compareAtPrice × currencyRate) / (1 + tax_rate) = DKK EX VAT`
   - **EUR**: × 7.46, **CHF**: × 6.84, **DKK**: × 1.0
7. **Table Separation:** bulk-sync-orders → orders table, bulk-sync-skus → skus table
8. **Extensions:** pg_cron + pg_net must both be enabled for automation
9. **Deployment:** Always use `--no-verify-jwt` flag
10. **🚨 CRITICAL (2025-10-22): `omsaetning_net` is BRUTTO revenue (without refunds)!**
    - **Formula in DB**: `omsaetning_net = (price_dkk × quantity) - total_discount_dkk - cancelled_amount_dkk`
    - **Does NOT subtract**: `refunded_amount` (stored in separate column)
    - **Why**: Refunds happen on different dates than sales
    - **Edge Functions MUST**: Sum `omsaetning_net`, then subtract `refunded_amount` to get net
    - **Example**: Sales 948.10 kr + Refunds 116.21 kr → Net 831.89 kr
    - **NEVER assume** `omsaetning_net` is final revenue without checking refunds!

## 🔍 Quick Troubleshooting Guide

### "Missing data in dashboard"
1. Check if SKUs were synced (not just orders): `./check-sync-status.sh <date-range>`
2. Verify filtering by `created_at_original` in queries
3. Run complete sync: `./sync-complete.sh <start> <end>`

### "Sync timeout on large date range"
1. Use incremental job creation: `./create-all-jobs.sh <start> <end>`
2. Jobs process automatically every 5 minutes
3. Monitor progress: `./live-sync-monitor.sh`

### "Duplicate key violations"
1. bulk-sync-skus should aggregate duplicates automatically
2. If persists, check for race conditions in parallel syncs
3. Use smart sync to auto-fix: `./smart-incremental-sync.sh <date-range>`

### "Jobs stuck as 'running'"
1. Check watchdog is active: `./test-watchdog.sh`
2. Ensure pg_net extension is enabled in Supabase
3. Manual cleanup: `./cleanup-stale-jobs.sh`
