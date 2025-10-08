# CLAUDE.md - Shopify Analytics Project Documentation

## 🧩 Project Context
This project syncs Shopify order and SKU data to Supabase for analytics and reporting.

**Architecture:**
- Supabase Edge Functions (TypeScript/Deno runtime)
- Shopify Admin GraphQL Bulk Operations API
- PostgreSQL database with scheduled jobs (pg_cron + pg_net)

## 🗄️ Database Tables

### `orders` table
- Stores order-level data (totals, shipping, discounts)
- `created_at`: TIMESTAMPTZ (timezone-aware, Shopify order creation timestamp)
- Primary key: `(shop, order_id)`

### `skus` table
- Stores line item (SKU) level data with discount breakdown
- `created_at`: DATE (YYYY-MM-DD format, for filtering/grouping)
- `created_at_original`: TIMESTAMPTZ (preserves original Shopify order timestamp)
- Primary key: `(shop, order_id, sku)`

**CRITICAL: Date Filtering**
- ✅ ALWAYS filter `skus` by `created_at_original` (not `created_at`)
- ❌ `created_at` gets overwritten to sync date - DO NOT use for date ranges
- ✅ Use `created_at_original` for all period-based analytics

### `bulk_sync_jobs` table
- Job queue for orchestrator pattern
- Tracks sync progress: pending → running → completed/failed

## 🔄 Sync Functions

### **bulk-sync-orders**
- **Purpose:** Syncs order-level data to `orders` table only
- **Method:** Shopify Bulk Operations API (GraphQL)
- **Does NOT write to `skus` table** (handled by bulk-sync-skus)

### **bulk-sync-skus**
- **Purpose:** Syncs SKU/line item data to `skus` table
- **Method:** Shopify Bulk Operations API (GraphQL)
- **Features:**
  - ✅ Duplikat-aggregering (prevents ON CONFLICT errors)
  - ✅ Sets `created_at_original` from Shopify order timestamp
  - ✅ Calculates discount breakdown:
    - `discount_per_unit_dkk` (order-level discounts)
    - `sale_discount_per_unit_dkk` (compareAtPrice - sellingPrice)
    - `original_price_dkk` (compareAtPrice from Shopify)
  - ✅ Handles cancelled_qty/cancelled_amount_dkk (set to 0, updated by bulk-sync-refunds)

### **bulk-sync-refunds**
- **Purpose:** Updates SKU refund/cancellation data
- **Updates:** `refunded_qty`, `refunded_amount_dkk`, `cancelled_qty`, `cancelled_amount_dkk`, `refund_date`
- **Does NOT overwrite:** discount fields, created_at_original, or other SKU data

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

## 📊 Discount Calculation Logic

**Dashboard "Rabat ex moms" = Order Discounts + Sale Discounts**

### Order-Level Discounts
- Applied to entire order (discount codes, automatic discounts)
- Stored in: `discount_per_unit_dkk`, `total_discount_dkk`

### Sale/Campaign Discounts
- Difference between list price (compareAtPrice) and selling price
- Stored in: `sale_discount_per_unit_dkk`, `sale_discount_total_dkk`
- `original_price_dkk` = compareAtPrice (the "before sale" price)

**CRITICAL FIX (October 2025):**
- Previously used `originalUnitPriceSet` (wrong - that's price before order discounts)
- Now correctly uses `compareAtPrice` (list price before any sales/campaigns)
- Dashboard API must SELECT both `discount_per_unit_dkk` AND `sale_discount_per_unit_dkk`

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

## ⚙️ Development Style
- Keep answers concise and focused
- No session history summaries or context reconstruction
- Each task is self-contained
- If ambiguous, ask a single clarifying question
- **IMPORTANT:** When providing SQL for user to run manually, ALWAYS output raw SQL in code block (never use mcp__supabase__execute_sql which times out)

## 🧱 Technical Stack
- **Runtime:** Deno (Supabase Edge)
- **API:** Shopify Admin GraphQL Bulk Operations API
- **Database:** Supabase (PostgreSQL)
- **Language:** TypeScript
- **Scheduling:** pg_cron + pg_net extensions

## 📦 Deployment
```bash
npx supabase functions deploy <function-name> --no-verify-jwt
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

### Dollar-Quoted String Syntax Error
**Symptom:** `ERROR: 42601: syntax error at or near "$"`

**Cause:** Single `$` instead of `$$` in PostgreSQL

**Solution:** Use `$$` to delimit function body in cron jobs

## 📚 Key Files

### Edge Functions
- `supabase/functions/bulk-sync-orders/index.ts` - Order sync (orders table only)
- `supabase/functions/bulk-sync-skus/index.ts` - SKU sync (skus table with full discount logic)
- `supabase/functions/bulk-sync-refunds/index.ts` - Refund/cancellation updates
- `supabase/functions/bulk-sync-orchestrator/index.ts` - Job creator
- `supabase/functions/continue-orchestrator/index.ts` - Job processor
- `supabase/functions/watchdog/index.ts` - Stale job cleanup

### API Endpoints
- `api/analytics.js` - Main analytics API
- `api/metadata.js` - Product metadata API
- `api/fulfillments.js` - Delivery analytics API

### Helper Scripts
- `restart-orchestrator.sh` - Start large backfills
- `check-sync-status.sh` - Check job status
- `test-watchdog.sh` - Test watchdog cleanup
- `cleanup-stale-jobs.sh` - Manual cleanup

### Documentation
- `SYNC-MANUAL.md` - Sync workflow guide (Danish)
- `CLAUDE.md` - This file

## 🎯 Critical Rules

1. **Date Filtering:** ALWAYS use `created_at_original` for SKU date ranges
2. **Discount Fields:** Dashboard must SELECT both `discount_per_unit_dkk` AND `sale_discount_per_unit_dkk`
3. **Price Fields:** bulk-sync-skus uses `compareAtPrice` (not `originalUnitPriceSet`) for sale discounts
4. **Duplikater:** bulk-sync-skus aggregates duplicates before upsert
5. **Table Separation:** bulk-sync-orders → orders table, bulk-sync-skus → skus table
6. **Extensions:** pg_cron + pg_net must both be enabled for automation
7. **Deployment:** Always use `--no-verify-jwt` flag
