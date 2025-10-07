# CLAUDE.md (Clean Version)

## 🧩 Project Context
This project contains Supabase Edge Functions written in TypeScript/Deno for syncing Shopify data to Supabase.

**Core Functions:**
- `bulk-sync-orders` - Syncs order data from Shopify to `orders` table
- `bulk-sync-skus` - Syncs SKU/line item data from Shopify to `skus` table
- `bulk-sync-orchestrator` - Creates daily job queue in `bulk_sync_jobs` table
- `continue-orchestrator` - Processes pending jobs incrementally (20 per run)
- `watchdog` - Cleans up stale "running" jobs (>2 minutes old)

## ⚙️ Development Style
- Keep answers concise and focused.
- Never summarize or rebuild previous context.
- Always start fresh from the current user message.
- No session resume, no long historical analysis.

## 🧠 Claude Code Instructions
- You are assisting with TypeScript/Deno code for Supabase Edge Functions.
- You may read or modify files inside `supabase/functions/*`.
- Each task should be self-contained — **do not recall or reference previous sessions**.
- Never write multi-page summaries.  
- Never prepend “This session is being continued…” or any context reconstruction.  

## 🚀 Task Behavior
When the user asks for help:
1. Read the relevant file(s).
2. Apply the requested change.
3. Respond with only the modified code or concise notes.
4. If a prompt is ambiguous, ask a single clarifying question — don’t guess.

## 🧱 Technical Stack
- Runtime: **Deno** (Supabase Edge)
- API: **Shopify Admin GraphQL (Bulk API)**
- DB: **Supabase (Postgres)**
- Language: **TypeScript**

## 📦 Deployment
**ALWAYS** deploy with `--no-verify-jwt`:
```bash
npx supabase functions deploy <function-name> --no-verify-jwt
```

## 🔄 Orchestration Architecture

### Problem: Edge Function Timeout Limits
Supabase Edge Functions have a **~6-7 minute hard timeout limit**. For large date ranges (>7 days), the original `bulk-sync-orchestrator` would timeout before completing all jobs.

### Solution: Incremental Processing Pattern

**Two-Step Approach:**

1. **Job Creation** (`bulk-sync-orchestrator`)
   - Creates all daily jobs in `bulk_sync_jobs` table
   - May timeout on large ranges - **this is expected and OK**
   - Jobs are persisted in database with `status = 'pending'`

2. **Job Processing** (`continue-orchestrator`)
   - Processes 20 pending jobs per invocation (~2-3 minutes)
   - Stateless - can be called repeatedly until complete
   - Returns status showing remaining work
   - Safe to call when no work remains

### Automated Continuation

**Auto-Continue Cron Job** (runs every 5 minutes):
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

**Requirements:** Both `pg_cron` AND `pg_net` extensions must be enabled in Supabase.

### Usage Pattern for Large Backfills

```bash
# Step 1: Create jobs (will timeout - OK)
./restart-orchestrator.sh

# Step 2: Auto-continue cron job processes them automatically
# Or call manually:
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{}'

# Step 3: Check status
./check-sync-status.sh 2025-08-01 2025-09-30
```

### Watchdog for Stale Jobs

**Purpose:** Cleans up jobs stuck in "running" state for >2 minutes.

**Cron Job** (runs every minute):
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

## 🧹 Reset Behavior
Every new session should start clean.  
Do **not** attempt to restore context from memory, logs, or summaries.  
Do **not** produce session history overviews.

---

✅ **Key Rule:**  
> “Each message is a new context. Never summarize or rebuild prior conversation history.”

🧭 Date and Timestamp Handling Rules

Important: Different tables use different date column types — all logic and queries must respect this distinction.

🗓️ skus table
	•	created_at → DATE (no timezone)
	•	All comparisons must use "YYYY-MM-DD" format (no Z, no time offset).
	•	Always cast incoming timestamps to DATE before filtering:

    const startDate = new Date(reqBody.startDate).toISOString().split("T")[0];
const endDate = new Date(reqBody.endDate).toISOString().split("T")[0];
await supabase
  .from("skus")
  .select("*")
  .gte("created_at", startDate)
  .lte("created_at", endDate);

  ⏰ orders table
	•	created_at → TIMESTAMPTZ (timezone-aware)
	•	All comparisons must preserve full timestamp precision.
	•	Use ISO strings (with "Z") for comparisons:

    const startISO = new Date(reqBody.startDate).toISOString();
const endISO = new Date(reqBody.endDate).toISOString();
const { data } = await supabase
  .from("orders")
  .select("*")
  .gte("created_at", startISO)
  .lte("created_at", endISO);

  ⚙️ General Rules
	•	Never assume the same date precision between tables.
	•	When joining orders → skus:
	•	Match on DATE(orders.created_at) = skus.created_at
	•	or normalize both to the same day boundary.
	•	Shopify Bulk API returns timestamps → must be converted before upsert into skus.

## 🛠️ Common Troubleshooting

### Watchdog Cron Job Not Running
**Symptom:** Jobs stuck as "running", watchdog exists but doesn't execute automatically.

**Cause:** Missing `pg_net` extension (only `pg_cron` enabled).

**Solution:**
1. Go to Supabase Dashboard → Database → Extensions
2. Enable `pg_net` extension
3. Verify with: `SELECT * FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`

### Orchestrator Timeout on Large Date Ranges
**Symptom:** Orchestrator times out after 6-7 minutes, only processes partial jobs.

**Cause:** Edge Function timeout limit - can't process all jobs in one execution.

**Solution:** Use the two-step incremental pattern:
1. Run `./restart-orchestrator.sh` to create pending jobs
2. Set up `auto-continue-orchestrator` cron job (every 5 minutes)
3. Let it automatically complete the backfill

### Dollar-Quoted String Syntax Error
**Symptom:** `ERROR: 42601: syntax error at or near "$"`

**Cause:** Single `$` instead of `$$` for dollar-quoted strings in PostgreSQL.

**Solution:** Use `$$` to delimit the function body in cron job SQL:
```sql
SELECT cron.schedule(
  'job-name',
  '* * * * *',
  $$
  SELECT net.http_post(...);
  $$
);
```

## 📚 Key Files

### Edge Functions
- `supabase/functions/bulk-sync-orders/index.ts` - Order sync via Shopify Bulk API
- `supabase/functions/bulk-sync-skus/index.ts` - SKU sync via Shopify Bulk API
- `supabase/functions/bulk-sync-orchestrator/index.ts` - Job queue creator
- `supabase/functions/continue-orchestrator/index.ts` - Incremental job processor
- `supabase/functions/watchdog/index.ts` - Stale job cleanup

### Helper Scripts
- `restart-orchestrator.sh` - Wrapper to restart orchestrator for large backfills
- `check-sync-status.sh` - Show job completion status for date range
- `test-watchdog.sh` - Manually test watchdog cleanup
- `cleanup-stale-jobs.sh` - Direct SQL cleanup of stale jobs

### Documentation
- `SYNC-MANUAL.md` - Complete sync workflow documentation (Danish)
- `CLAUDE.md` - This file - technical context for AI assistant