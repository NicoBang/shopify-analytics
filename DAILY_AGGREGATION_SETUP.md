# Daily Aggregation Setup Guide

Komplet guide til opsætning af daglig aggregering af metrics.

## 📊 Oversigt

Systemet aggregerer dagligt tre metrics tabeller:
- **`daily_shop_metrics`** - Shop-level metrics (allerede kørt via `aggregate-daily-metrics`)
- **`daily_color_metrics`** - Artikelnummer-level metrics (ny)
- **`daily_sku_metrics`** - SKU-level metrics med størrelse (ny)

## 🎯 Smart Logik

Alle Edge Functions har identisk smart logik:

### STEP 1: Aggreger dagens data
Beregner metrics for gårsdagen (created_at_original = gårsdagens danske dato)

### STEP 2: Find opdaterede SKUs
Finder alle SKUs med `updated_at` inden for sidste 24 timer (22:00 i går til 22:00 i dag dansk tid)

### STEP 3: Track datoer der skal re-aggregeres
- Hvis SKU blev created 1. september men updated i dag → re-aggreger 1. september
- Hvis refund skete 10. oktober men SKU blev updated i dag → re-aggreger 10. oktober

### STEP 4: Re-aggreger alle påvirkede datoer
Kører aggregering for hver historic dato der blev påvirket af gårsdagens opdateringer

## 📅 Tidsplan

```
02:00 UTC - Sync jobs kører (orders, SKUs, refunds)
04:00 UTC - daily_shop_metrics aggregeres
04:10 UTC - daily_color_metrics aggregeres
04:20 UTC - daily_sku_metrics aggregeres
```

10 minutters mellemrum sikrer at hver aggregering kan færdiggøres før næste starter.

## 🚀 Deployment

### 1. Migrations (Allerede Kørt)
```bash
# Tilføj cancelled_amount kolonner
psql < supabase/migrations/20251023_add_cancelled_amount_to_color_metrics.sql
psql < supabase/migrations/20251023_add_cancelled_amount_to_sku_metrics.sql

# Opret SQL functions
psql < supabase/migrations/20251022_create_aggregate_functions.sql
```

### 2. Deploy Edge Functions
```bash
npx supabase functions deploy aggregate-color-metrics --no-verify-jwt
npx supabase functions deploy aggregate-sku-metrics --no-verify-jwt
```

Eller brug deployment script:
```bash
./deploy-daily-aggregation.sh
```

### 3. Aktivér Cron Jobs
```bash
psql < supabase/migrations/20251022_setup_daily_aggregation_cron.sql
```

### 4. Verificer Setup
```sql
-- Check cron jobs
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname LIKE '%aggregate%'
ORDER BY jobname;

-- Should return:
-- daily-aggregate-shop-metrics   | 0 4 * * *  | active
-- daily-aggregate-color-metrics  | 10 4 * * * | active
-- daily-aggregate-sku-metrics    | 20 4 * * * | active
```

## 🧪 Manuel Test

Test at functions virker for en specifik dato:

```bash
# Test color metrics
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-color-metrics" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-10-21"}'

# Test SKU metrics
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/aggregate-sku-metrics" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-10-21"}'
```

Eller via SQL:
```sql
-- Aggreger specifik dato
SELECT aggregate_color_metrics_for_date('2025-10-21'::date);
SELECT aggregate_sku_metrics_for_date('2025-10-21'::date);

-- Check resultater
SELECT 'color_metrics' as table_name, COUNT(*) as count
FROM daily_color_metrics
WHERE metric_date = '2025-10-21'
UNION ALL
SELECT 'sku_metrics' as table_name, COUNT(*) as count
FROM daily_sku_metrics
WHERE metric_date = '2025-10-21';
```

## 📁 Vigtige Filer

### Edge Functions
- `supabase/functions/aggregate-daily-metrics/index.ts` - Shop metrics (eksisterende)
- `supabase/functions/aggregate-color-metrics/index.ts` - Color metrics (ny)
- `supabase/functions/aggregate-sku-metrics/index.ts` - SKU metrics (ny)

### SQL Functions
- `supabase/migrations/20251022_create_aggregate_functions.sql`
  - `aggregate_color_metrics_for_date(target_date DATE)`
  - `aggregate_sku_metrics_for_date(target_date DATE)`

### Cron Setup
- `supabase/migrations/20251022_setup_daily_aggregation_cron.sql`

### Schema Fixes
- `supabase/migrations/20251023_add_cancelled_amount_to_color_metrics.sql`
- `supabase/migrations/20251023_add_cancelled_amount_to_sku_metrics.sql`

## 🐛 Fejlfinding

### "Column cancelled_amount does not exist"
**Løsning:** Kør schema fix migrations (20251023_add_cancelled_amount_*)

### "Function does not exist"
**Løsning:** Kør `20251022_create_aggregate_functions.sql`

### "Cron job not running"
**Verificer:**
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE '%aggregate%';
```

**Check last run:**
```sql
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE '%aggregate%'
)
ORDER BY start_time DESC
LIMIT 10;
```

### Edge Function timeout
**Symptom:** Function times out efter 5 minutter

**Løsning:** Edge Functions har 5 min timeout (konfigureret i cron). Hvis det ikke er nok:
1. Split data i mindre batches
2. Øg timeout i cron job (maks 10 min)
3. Optimér SQL queries

## ✅ Success Criteria

Efter deployment skal du se:

1. **3 aktive cron jobs** kørende kl 04:00, 04:10, 04:20 UTC
2. **Data i alle 3 tabeller** opdateret hver morgen
3. **Re-aggregering** af historiske datoer når refunds/opdateringer sker
4. **Ingen fejl** i cron.job_run_details

## 🔄 Vedligeholdelse

### Backfill Historical Data
Hvis du skal re-aggregere mange dage:

```bash
# Brug re-aggregate-all.sh for shop metrics
./re-aggregate-all.sh

# For color/sku metrics, kør SQL function i loop
DO $$
DECLARE
  current_date DATE := '2025-09-01';
  end_date DATE := '2025-10-22';
BEGIN
  WHILE current_date <= end_date LOOP
    PERFORM aggregate_color_metrics_for_date(current_date);
    PERFORM aggregate_sku_metrics_for_date(current_date);
    current_date := current_date + INTERVAL '1 day';
  END LOOP;
END $$;
```

### Monitor Daglig Kørsel
Tjek hver morgen at cron jobs kørte succesfuldt:

```sql
SELECT
  j.jobname,
  jrd.status,
  jrd.return_message,
  jrd.start_time,
  jrd.end_time,
  (jrd.end_time - jrd.start_time) as duration
FROM cron.job j
JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
WHERE j.jobname LIKE '%aggregate%'
  AND jrd.start_time > NOW() - INTERVAL '24 hours'
ORDER BY jrd.start_time DESC;
```

## 🎓 Læring fra Fejl

### Bug #1: Cancelled Amount Multiplication
**Problem:** SQL aggregerede `cancelled_amount_dkk * cancelled_qty`, men feltet er ALLEREDE total amount.

**Løsning:** Ændret til `SUM(COALESCE(cancelled_amount_dkk, 0))` i alle functions.

**Impact:** Påvirkede IKKE `daily_shop_metrics` (var allerede korrekt), men kunne have påvirket color/sku hvis ikke opdaget tidligt.

### Bug #2: Missing Column
**Problem:** `daily_color_metrics` og `daily_sku_metrics` manglede `cancelled_amount` kolonne.

**Løsning:** Tilføjet via migrations med backfill fra existing data.

**Læring:** Altid verificer tabel schema matcher SQL function forventninger før deployment.

## 📞 Support

Hvis der er problemer:
1. Check cron job status i databasen
2. Check Edge Function logs i Supabase Dashboard
3. Kør manuel test for at isolere problemet
4. Verificer SQL functions virker direkte i database
