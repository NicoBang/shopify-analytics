# Shopify Analytics Sync Manual

Komplet guide til at synce Shopify data til Supabase.

---

## 📋 Oversigt

**Fem typer syncs:**
1. **Orders & SKUs** - Syncer ordrer og SKU data baseret på `created_at`
2. **Refund Orders** - Syncer ordrer med refunds baseret på `updated_at`
3. **Orchestrator** - Automatisk sync af alle shops for en periode
4. **Fulfillments** - Syncer leveringsdata fra Shopify (via Vercel API)
5. **Product Metadata** - Syncer produkt metadata og attributter (via Vercel API)

**Automatiske daglige syncs:**
- 🌅 **Daglig kl. 06:00** - Sync orders, refunds og fulfillments for gårsdagens dato
- 📦 **Ugentlig søndag kl. 02:00** - Sync produkt metadata for alle shops

---

## 🚀 Quick Start

### Sync en periode (normale ordrer)
```bash
./sync-date-range.sh 2025-10-01 2025-10-07
```

**Note:** For store perioder (>7 dage), brug i stedet:
```bash
# Step 1: Opret jobs (vil timeout - det er OK)
./restart-orchestrator.sh 2025-08-01 2025-09-30

# Step 2: Lad auto-continue cron job processe dem (hver 5. minut)
# Eller kald manuelt:
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{}'
```

### Sync opdaterede ordrer for en periode (refunds, edits, etc.)
```bash
./sync-date-range-refunds.sh 2025-10-01 2025-10-07
```

### Tjek status
```bash
./check-sync-status.sh 2025-10-01 2025-10-07
```

### Retry fejlede jobs
```bash
./retry-failed-jobs.sh
```

### Sync fulfillments (leveringer)
```bash
./sync-fulfillments.sh 2025-10-01 2025-10-07
```

### Sync product metadata
```bash
./sync-metadata.sh
```

---

## 📖 Detaljerede Commands

### 1. Orchestrator (Fuld Sync)

**Brug:** Syncer alle shops for en periode med både orders og SKUs.

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shops": [
      "pompdelux-da.myshopify.com",
      "pompdelux-de.myshopify.com",
      "pompdelux-nl.myshopify.com",
      "pompdelux-int.myshopify.com",
      "pompdelux-chf.myshopify.com"
    ],
    "types": ["both"],
    "startDate": "2025-10-01",
    "endDate": "2025-10-07"
  }'
```

**Eller brug scriptet:**
```bash
./sync-date-range.sh 2025-10-01 2025-10-07
```

**Features:**
- Syncer alle 5 shops automatisk
- Skip logic - springer completed jobs over
- Periodic cleanup af stale jobs hver 10. job
- Kører i baggrunden (timeout efter ~6 minutter)

---

### 2. Sync Orders (Manual)

**Brug:** Sync enkelte shop/dato kombinationer for orders.

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-01",
    "endDate": "2025-10-01",
    "objectType": "orders"
  }'
```

**Parametre:**
- `shop` - Shopify shop domain
- `startDate` - Start dato (YYYY-MM-DD)
- `endDate` - Slut dato (YYYY-MM-DD)
- `objectType` - "orders", "skus", eller "both"

---

### 3. Sync SKUs (Manual)

**Brug:** Sync SKU data for en ordre periode.

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-10-01",
    "endDate": "2025-10-01"
  }'
```

---

### 4. Sync Refund Orders

**Brug:** Sync ordrer der HAR refunds i perioden (baseret på `updated_at`).

**Vigtigt:** Dette fanger ordrer fra tidligere perioder der får refund i den valgte periode.

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refund-orders" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-09-01",
    "endDate": "2025-09-30"
  }'
```

**Features:**
- **Smart cleanup:** Henter data fra Shopify FØRST, sletter kun de ordrer der returneres
- Kan køres gentagne gange uden datatab - opdaterer kun hvad Shopify returnerer
- Syncer BÅDE orders og SKUs med refund data
- Bruger `updated_at` i stedet for `created_at`
- Beholder gamle data hvis Shopify ikke returnerer ordren

---

### 5. Sync Fulfillments (Leveringer)

**Brug:** Syncer leveringsdata for alle shops i en periode.

**Via Vercel API (ikke Edge Function):**

```bash
SHOPS=("pompdelux-da.myshopify.com"
       "pompdelux-de.myshopify.com"
       "pompdelux-nl.myshopify.com"
       "pompdelux-int.myshopify.com"
       "pompdelux-chf.myshopify.com")

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-9ckj1fm3r-nicolais-projects-291e9559.vercel.app/api/sync-shop?shop=$shop&type=fulfillments&startDate=2025-10-01&endDate=2025-10-07" &
done

wait
echo "✅ Alle shops synkroniseret med fulfillments"
```

**Eller brug scriptet:**
```bash
./sync-fulfillments.sh 2025-10-01 2025-10-07
```

**Features:**
- Syncer leveringsdata (carrier, item_count, country)
- Bruger dato-interval ligesom orders sync
- Kører alle shops parallelt med `&`

**Vigtigt:**
- Dette er en **Vercel API**, ikke en Edge Function
- Bruger deployment URL (ikke production URL)
- Bearer token er fra Vercel, ikke Supabase

---

### 6. Sync Product Metadata

**Brug:** Syncer produkt metadata og attributter for alle shops.

**Via Vercel API (ikke Edge Function):**

```bash
SHOPS="pompdelux-da.myshopify.com"

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-9ckj1fm3r-nicolais-projects-291e9559.vercel.app/api/sync-shop?shop=$shop&type=metadata" &
done

wait
echo "✅ Alle shops synkroniseret med product metadata"
```

**Eller brug scriptet:**
```bash
./sync-metadata.sh
```

**Features:**
- Syncer produkt metadata (program, season, gender, tags, etc.)
- **Ingen dato-interval** - henter aktuel metadata fra Shopify
- Opdaterer `product_metadata` tabel med seneste data
- Kører alle shops parallelt med `&`

**Vigtigt:**
- Dette er en **Vercel API**, ikke en Edge Function
- Metadata sync er **ikke dato-baseret** - henter altid seneste data
- Bearer token er fra Vercel, ikke Supabase

---

## 🔍 Status & Monitoring

### Tjek sync status for periode
```bash
./check-sync-status.sh 2025-09-01 2025-09-30
```

**Output:**
```
📊 Summary:
   Total expected: 300
   ✅ Completed:   296 (98%)
   ❌ Failed:      4
   🔄 Running:     0
   ⚠️  Missing:     4
```

### Tjek enkelt dag
```bash
./check-sync-status.sh 2025-09-15 2025-09-15
```

### Default (Sep 1 - dagens dato)
```bash
./check-sync-status.sh
```

---

## 🧹 Maintenance Commands

### Cleanup stale jobs
Markér jobs der har kørt >2 minutter som failed:

```bash
./cleanup-stale-jobs.sh
```

**Output:**
```
✅ Cleaned up 3 stale jobs

📊 Current status summary:
completed: 593
failed: 397
```

---

## 🔄 Retry Failed Jobs

### Auto-retry script
Laver automatisk retry af kendte fejlede jobs:

```bash
./retry-failed-jobs.sh
```

### Manual retry af specifik job
```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orders" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-de.myshopify.com",
    "startDate": "2025-09-30",
    "endDate": "2025-09-30",
    "objectType": "orders"
  }'
```

---

## 🎯 Common Workflows

### Daily Sync (Daglig kørsel)
```bash
# Sync gårsdagens data
./sync-date-range.sh $(date -v-1d +%Y-%m-%d) $(date -v-1d +%Y-%m-%d)

# Tjek status
./check-sync-status.sh $(date -v-1d +%Y-%m-%d) $(date -v-1d +%Y-%m-%d)
```

### Monthly Sync (Månedlig kørsel)
```bash
# Sync hele september
./sync-date-range.sh 2025-09-01 2025-09-30

# Tjek status
./check-sync-status.sh 2025-09-01 2025-09-30

# Cleanup stale jobs
./cleanup-stale-jobs.sh

# Retry fejlede
./retry-failed-jobs.sh
```

### Refund Sync (Efter orders sync)
```bash
# Først: Sync normale ordrer for september
./sync-date-range.sh 2025-09-01 2025-09-30

# Så: Sync refund ordrer (fanger gamle ordrer med nye refunds)
./sync-date-range-refunds.sh 2025-09-01 2025-09-30
```

### Complete Daily Sync (Anbefalet workflow)
```bash
# 1. Sync ordrer og SKUs
./sync-date-range.sh 2025-10-01 2025-10-07

# 2. Sync refunds (opdaterer eksisterende SKUs)
./sync-date-range-refunds.sh 2025-10-01 2025-10-07

# 3. Sync leveringsdata
./sync-fulfillments.sh 2025-10-01 2025-10-07

# 4. Sync produkt metadata (kører ugentligt eller månedligt)
./sync-metadata.sh

# 5. Tjek status
./check-sync-status.sh 2025-10-01 2025-10-07
```

---

## ⚠️ Troubleshooting

### Orchestrator stopper efter 6-7 min
**Problem:** Orchestrator har ~6-7 min Edge Function timeout.

**Løsning:** Brug to-trins incremental pattern:
```bash
# Step 1: Opret alle jobs (vil timeout - det er OK)
./restart-orchestrator.sh 2025-08-01 2025-09-30

# Step 2: Lad auto-continue cron job processe dem automatisk (hver 5. minut)
# Eller kald manuelt:
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{}'

# Step 3: Tjek status
./check-sync-status.sh 2025-08-01 2025-09-30
```

### Jobs står fast som "running"
**Problem:** Edge Function timeout har dræbt job, men status er ikke opdateret.

**Løsning 1 (Manual):**
```bash
./cleanup-stale-jobs.sh
```

**Løsning 2 (Automatisk - Anbefalet):**
Watchdog funktionen kører automatisk hver 2. minut og cleaner stalled jobs.

**Setup Watchdog (Supabase Cron):**
1. Gå til Supabase Dashboard → Database → Cron Jobs
2. Lav ny cron job:
   ```sql
   SELECT net.http_post(
     url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/watchdog-cleanup',
     headers := jsonb_build_object(
       'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
       'Content-Type', 'application/json'
     )
   );
   ```
3. Schedule: `*/2 * * * *` (hver 2. minut)
4. Enable job

**Test Watchdog Manual:**
```bash
./test-watchdog.sh
```

### Failed jobs efter orchestrator run
**Problem:** Enkelte jobs fejler under bulk sync.

**Løsning:**
1. Tjek hvilke der fejlede: `./check-sync-status.sh`
2. Retry manuelt eller brug `./retry-failed-jobs.sh`

### Duplicates i database
**Problem:** Samme ordre/SKU eksisterer flere gange.

**Løsning:** Upsert håndterer normalt dette automatisk. Hvis det sker:
- bulk-sync-refund-orders har pre-cleanup
- Manuel cleanup kan køres hvis nødvendigt

---

## 📚 Reference

### Alle shops
```
pompdelux-da.myshopify.com
pompdelux-de.myshopify.com
pompdelux-nl.myshopify.com
pompdelux-int.myshopify.com
pompdelux-chf.myshopify.com
```

### Object types
- `orders` - Kun ordrer
- `skus` - Kun SKU data
- `both` - Både ordrer og SKUs (anbefalet)

### Timeouts
- Edge Functions: ~6-7 minutter hard limit
- Stale job threshold: 2 minutter
- Orchestrator periodic cleanup: Hver 10. job

### Date formats
- Input: `YYYY-MM-DD` (f.eks. "2025-09-01")
- Database orders.created_at: `TIMESTAMPTZ`
- Database skus.created_at: `DATE`

---

## 🔐 Environment Variables

### Manuele Scripts
Alle scripts bruger:
```bash
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
```

### Automatiske Syncs (Supabase Secrets)
Konfigurer via Dashboard → Functions → Manage Secrets:
```bash
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM
VERCEL_API_TOKEN=bda5da3d49fe0e7391fded3895b5c6bc
VERCEL_API_URL=https://shopify-analytics-9ckj1fm3r-nicolais-projects-291e9559.vercel.app
```

---

## 📝 Quick Reference Card

| Task | Command |
|------|---------|
| Full sync (created_at) | `./sync-date-range.sh START END` |
| Refund sync (updated_at) | `./sync-date-range-refunds.sh START END` |
| Fulfillments sync | `./sync-fulfillments.sh START END` |
| Metadata sync | `./sync-metadata.sh` |
| Check status | `./check-sync-status.sh START END` |
| Retry failed | `./retry-failed-jobs.sh` |
| Cleanup stale | `./cleanup-stale-jobs.sh` |
| Single order sync | `bulk-sync-orders` + curl |
| Single SKU sync | `bulk-sync-skus` + curl |
| Manual refund sync | `bulk-sync-refund-orders` + curl |

---

## 🏗️ Arkitektur Oversigt

### Edge Functions (Supabase)
Køres på Supabase infrastruktur med service role key:
- `bulk-sync-orders` - Syncer ordrer baseret på `created_at`
- `bulk-sync-skus` - Syncer SKU data baseret på ordre dato
- `bulk-sync-refund-orders` - Syncer refund data baseret på `updated_at`
- `bulk-sync-orchestrator` - Koordinerer syncs på tværs af shops og datoer

### Vercel API'er
Køres på Vercel infrastruktur med Vercel bearer token:
- `/api/sync-shop?type=fulfillments` - Syncer leveringsdata
- `/api/sync-shop?type=metadata` - Syncer produkt metadata

**Vigtigt:** Edge Functions og Vercel API'er bruger forskellige authentication tokens!

---

## ⏰ Automatiske Daglige Syncs

### Opsætning

**1. Enable PostgreSQL Extensions**

Gå til **Supabase Dashboard → Database → Extensions** og enable:
- ✅ `pg_cron` - Scheduler til cron jobs
- ✅ `pg_net` - HTTP requests fra database

**2. Konfigurer Secrets**

Gå til **Supabase Dashboard → Functions → Manage Secrets** og tilføj:
```bash
VERCEL_API_TOKEN=bda5da3d49fe0e7391fded3895b5c6bc
VERCEL_API_URL=https://shopify-analytics-9ckj1fm3r-nicolais-projects-291e9559.vercel.app
```

*Note: SERVICE_ROLE_KEY er allerede sat som standard secret.*

**3. Opret Cron Jobs**

Gå til **Supabase Dashboard → Database → Cron Jobs** og opret tre jobs:

#### Auto-Continue Orchestrator (hver 5. minut)
```sql
SELECT cron.schedule(
  'auto-continue-orchestrator',
  '*/5 * * * *',  -- Hver 5. minut
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/continue-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Formål:** Processor automatisk pending jobs fra `bulk_sync_jobs` tabellen. Bruges til at fortsætte store backfills uden manuel intervention.

#### Daglig Sync (kl. 06:00 Copenhagen tid)
```sql
SELECT cron.schedule(
  'daily-sync',
  '0 5 * * *',  -- 05:00 UTC = 06:00 Copenhagen (vinter) / 07:00 (sommer)
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/daily-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

#### Ugentlig Metadata Sync (søndag kl. 02:00 Copenhagen tid)
```sql
SELECT cron.schedule(
  'weekly-metadata-sync',
  '0 1 * * 0',  -- 01:00 UTC søndag = 02:00 Copenhagen (vinter) / 03:00 (sommer)
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/weekly-metadata-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Hvad Synces Automatisk

**Daglig kl. 06:00:**
1. Orders & SKUs for gårsdagens dato
2. Refunds for gårsdagens dato
3. Fulfillments for gårsdagens dato (alle shops parallelt)

**Ugentlig søndag kl. 02:00:**
- Product metadata for alle shops (parallelt)

### Test Automatiske Syncs

**Test daglig sync manuelt:**
```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/daily-sync" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Test ugentlig metadata sync manuelt:**
```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/weekly-metadata-sync" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Tjek Cron Job Status

**Liste alle cron jobs:**
```sql
SELECT jobid, jobname, schedule, active, last_run, run_count
FROM cron.job
ORDER BY jobname;
```

**Se seneste kørsler:**
```sql
SELECT *
FROM cron.job_run_details
WHERE job_name IN ('daily-sync', 'weekly-metadata-sync')
ORDER BY start_time DESC
LIMIT 10;
```

**Disable/enable et job:**
```sql
-- Disable
SELECT cron.unschedule('daily-sync');

-- Enable igen
SELECT cron.schedule(...);  -- Brug SQL fra opsætningen ovenfor
```
