# Daglig Sync Oversigt

Dette dokument beskriver alle daglige syncs, deres formål, rækkefølge og afhængigheder.

## 📅 Hvad Synces Dagligt?

Hver nat kører systemet automatisk for at holde data opdateret. Her er hvad der synces baseret på **dagens dato**:

### 1. **Orders** - Ordrer created i dag
- **Formål**: Hent alle nye ordrer fra i dag
- **Søgekriterium**: `order.created_at = i dag`
- **Destination**: `orders` tabel
- **Funktion**: `bulk-sync-orders` (Bulk Operations API)
- **Tid**: ~2-3 minutter per shop

### 2. **SKUs** - Line items fra ordrer created i dag
- **Formål**: Hent alle line items (SKUs) fra dagens ordrer
- **Søgekriterium**: `order.created_at = i dag`
- **Destination**: `skus` tabel
- **Funktion**: `bulk-sync-skus` (Bulk Operations API)
- **Tid**: ~3-5 minutter per shop

### 3. **Refunds** - Refunds created i dag (uanset hvornår ordre blev lavet) ✨ NY LOGIK
- **Formål**: Opdater ordrer hvor der blev lavet refund i dag
- **Søgekriterium**: `refund.created_at = i dag` (ikke order.created_at!)
- **Destination**: `orders` (shipping_refund_dkk, refund_date) + `skus` (refunded_qty, refunded_amount_dkk)
- **Funktion**: `batch-sync-refunds` (REST API med batch processing, 50 ordrer ad gangen)
- **Tid**: Afhænger af antal ordrer med refunds
  - Normal dag (5-20 refunds): 1-2 minutter
  - Stor dag (800+ ordrer): Automatisk batch processing (flere iterationer)

### 4. **Shipping Discounts** - Ordrer with shipping discounts created i dag
- **Formål**: Opdater shipping discount data for dagens ordrer
- **Søgekriterium**: `order.created_at = i dag` + `shipping > 0`
- **Destination**: `orders` (shipping_discount_dkk)
- **Funktion**: `bulk-sync-shipping-discounts` (GraphQL API per order)
- **Tid**: ~1-2 minutter per shop

### 5. **Fulfillments** - Leveringsdata for ordrer created i dag
- **Formål**: Opdater leveringsstatus og leveringsdatoer
- **Søgekriterium**: `order.created_at = i dag` (søger 90 dage bagud for at fange forsinkede leveringer)
- **Destination**: `fulfillments` tabel
- **Funktion**: Vercel API `/api/sync-shop?type=fulfillments`
- **Tid**: ~2-5 minutter per shop (parallel across all shops)
- **Script**: `./sync-fulfillments.sh <startDate> <endDate>`

### 6. **Inventory** - Lagerbeholdning for alle produkter
- **Formål**: Opdater lagerstatus for alle SKUs
- **Søgekriterium**: Alle aktive produkter (ingen dato-filter)
- **Destination**: `inventory` tabel
- **Funktion**: Vercel API `/api/sync-shop?type=inventory`
- **Tid**: ~5-10 minutter per shop
- **Frekvens**: Dagligt eller efter behov

### 7. **Product Metadata (DKK)** - Produktpriser og information
- **Formål**: Opdater produktpriser, titel, sammenlign-pris for DKK shop
- **Søgekriterium**: Alle produkter fra pompdelux-da.myshopify.com
- **Destination**: `product_metadata` tabel
- **Funktion**: Vercel API `/api/sync-shop?type=metadata`
- **Tid**: ~10-20 minutter (afhænger af antal produkter)
- **Frekvens**: Ugentligt eller efter kampagner

### 8. **Product Metadata (EUR)** - Produktpriser for EUR shops
- **Formål**: Opdater produktpriser for EUR shops (DE, NL, INT)
- **Søgekriterium**: Alle produkter fra pompdelux-de.myshopify.com (repræsenterer alle EUR shops)
- **Destination**: `product_metadata_eur` tabel
- **Funktion**: Vercel API `/api/sync-shop?type=metadata-eur`
- **Tid**: ~10-20 minutter
- **Frekvens**: Ugentligt eller efter kampagner

### 9. **Product Metadata (CHF)** - Produktpriser for CHF shop
- **Formål**: Opdater produktpriser for CHF shop
- **Søgekriterium**: Alle produkter fra pompdelux-chf.myshopify.com
- **Destination**: `product_metadata_chf` tabel
- **Funktion**: Vercel API `/api/sync-shop?type=metadata-chf`
- **Tid**: ~10-20 minutter
- **Frekvens**: Ugentligt eller efter kampagner
- **Script**: `./sync-metadata.sh` (syncer alle 3 metadata tabeller parallelt)

## 🔄 Sync Rækkefølge & Afhængigheder

```
┌──────────────────────────────────────────────────────────────────┐
│ FASE 1: DAGLIGE ORDRER (kan køre parallelt for shops)          │
└──────────────────────────────────────────────────────────────────┘
          │
          ├─► Orders Sync (bulk-sync-orders)
          │   └─► Skriver til: orders table
          │
          └─► SKUs Sync (bulk-sync-skus)
              └─► Skriver til: skus table
              └─► AFHÆNGIG AF: Orders skal være syncet først

┌──────────────────────────────────────────────────────────────────┐
│ FASE 2: OPDATERINGER (kan køre parallelt)                       │
└──────────────────────────────────────────────────────────────────┘
          │
          ├─► Refunds Sync (batch-sync-refunds)
          │   └─► Opdaterer: orders + skus tables
          │   └─► AFHÆNGIG AF: Orders skal eksistere i DB
          │
          ├─► Shipping Discounts Sync (bulk-sync-shipping-discounts)
          │   └─► Opdaterer: orders table
          │   └─► AFHÆNGIG AF: Orders skal eksistere i DB
          │
          └─► Fulfillments Sync (Vercel API)
              └─► Skriver til: fulfillments table
              └─► AFHÆNGIG AF: Orders skal eksistere i DB

┌──────────────────────────────────────────────────────────────────┐
│ FASE 3: LAGER & METADATA (uafhængig, kan køre når som helst)   │
└──────────────────────────────────────────────────────────────────┘
          │
          ├─► Inventory Sync (Vercel API)
          │   └─► Skriver til: inventory table
          │   └─► INGEN AFHÆNGIGHEDER (kan køre uafhængigt)
          │
          ├─► Product Metadata DKK (Vercel API)
          │   └─► Skriver til: product_metadata table
          │   └─► INGEN AFHÆNGIGHEDER
          │
          ├─► Product Metadata EUR (Vercel API)
          │   └─► Skriver til: product_metadata_eur table
          │   └─► INGEN AFHÆNGIGHEDER
          │
          └─► Product Metadata CHF (Vercel API)
              └─► Skriver til: product_metadata_chf table
              └─► INGEN AFHÆNGIGHEDER
```

### Vigtige Afhængigheder

**Daglige Transaktionsdata:**
1. **Orders skal synces FØRST** - Alt andet opdaterer baseret på orders
2. **SKUs kan køre samtidig** med orders (men bruger orders data)
3. **Refunds, Shipping Discounts, Fulfillments** kan køre efter orders/SKUs er færdige
4. **Forskellige shops** kan køre parallelt

**Lager & Metadata:**
5. **Inventory og Metadata** har INGEN afhængigheder til orders
6. Kan køre når som helst (dagligt, ugentligt, eller efter kampagner)
7. Metadata tabeller kan synces parallelt (DKK, EUR, CHF)

## ⏰ Automatisk Scheduling

### Cron Jobs (Supabase)

**1. Bulk Sync Orchestrator** - Opretter jobs
```sql
-- Kører dagligt kl. 02:00
SELECT cron.schedule(
  'daily-sync-orchestrator',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'startDate', (CURRENT_DATE - INTERVAL '1 day')::text,
      'endDate', (CURRENT_DATE - INTERVAL '1 day')::text
    )::jsonb
  );
  $$
);
```

**2. Continue Orchestrator** - Processer jobs
```sql
-- Kører hvert 5. minut
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

**3. Watchdog** - Cleanup stale jobs
```sql
-- Kører hvert minut
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

**4. Auto-Validate Failed Jobs** - Marker empty days som completed
```sql
-- Kører dagligt kl. 02:00
SELECT cron.schedule(
  'auto-validate-failed-jobs',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/auto-validate-failed-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## 📊 Typisk Daglig Flow

### Eksempel: Sync for 2025-10-13

**Kl. 02:00** - Orchestrator starter
```
1. bulk-sync-orchestrator opretter jobs:
   - pompdelux-da: orders, skus, refunds, shipping-discounts
   - pompdelux-de: orders, skus, refunds, shipping-discounts
   - pompdelux-nl: orders, skus, refunds, shipping-discounts
   - pompdelux-int: orders, skus, refunds, shipping-discounts
   - pompdelux-chf: orders, skus, refunds, shipping-discounts

   Total: 20 jobs (5 shops × 4 typer)
   Status: pending
```

**Kl. 02:05** - Continue-orchestrator starter (første batch)
```
2. Processerer orders (3 shops parallelt):
   ├─► pompdelux-da: bulk-sync-orders (2 min) ✅
   ├─► pompdelux-de: bulk-sync-orders (2 min) ✅
   └─► pompdelux-nl: bulk-sync-orders (2 min) ✅

   Status: 3 completed, 17 pending
```

**Kl. 02:10** - Continue-orchestrator (næste batch)
```
3. Processerer næste orders + første SKUs:
   ├─► pompdelux-int: bulk-sync-orders (2 min) ✅
   ├─► pompdelux-chf: bulk-sync-orders (2 min) ✅
   └─► pompdelux-da: bulk-sync-skus (3 min) ✅

   Status: 6 completed, 14 pending
```

**Kl. 02:15** - Continue-orchestrator (fortsætter)
```
4. Processerer SKUs:
   └─► pompdelux-de: bulk-sync-skus (3 min) ✅

   Status: 7 completed, 13 pending
```

**Kl. 02:20** - Continue-orchestrator (fortsætter)
```
5. Processerer refunds og shipping discounts (kan køre parallelt):
   ├─► pompdelux-da: batch-sync-refunds (1 min, batch 1/2) ⏳
   ├─► pompdelux-de: bulk-sync-shipping-discounts (2 min) ✅
   └─► pompdelux-nl: batch-sync-refunds (30 sek) ✅

   Status: 9 completed, 11 pending (1 har status "pending" - venter på næste batch)
```

**Kl. 02:25** - Continue-orchestrator (næste batch for store refunds)
```
6. Fortsætter pompdelux-da refunds:
   └─► pompdelux-da: batch-sync-refunds (1 min, batch 2/2) ✅

   Status: 10 completed, 10 pending
```

**Kl. 02:30** - Alle transaktionsjobs færdige
```
✅ Total: 20 completed, 0 pending, 0 failed (orders, skus, refunds, shipping-discounts)
```

**Kl. 08:00** - Fulfillments sync (separat cron job)
```
7. Syncer leveringsdata for alle shops (parallel):
   ├─► pompdelux-da: fulfillments (2 min) ✅
   ├─► pompdelux-de: fulfillments (2 min) ✅
   ├─► pompdelux-nl: fulfillments (2 min) ✅
   ├─► pompdelux-int: fulfillments (2 min) ✅
   └─► pompdelux-chf: fulfillments (2 min) ✅

   Status: ✅ All fulfillments synced (parallel execution ~2-3 min total)
```

**Hver Onsdag kl. 03:00** - Metadata sync (ugentlig)
```
8. Syncer produktpriser og metadata (parallel):
   ├─► product_metadata (DKK): 10-20 min ✅
   ├─► product_metadata_eur (EUR): 10-20 min ✅
   └─► product_metadata_chf (CHF): 10-20 min ✅

   Status: ✅ All metadata tables synced (~15 min total)
```

**Ved behov** - Inventory sync
```
9. Syncer lagerstatus (on-demand eller dagligt):
   ├─► pompdelux-da: inventory (5 min) ✅
   ├─► pompdelux-de: inventory (5 min) ✅
   ├─► pompdelux-nl: inventory (5 min) ✅
   ├─► pompdelux-int: inventory (5 min) ✅
   └─► pompdelux-chf: inventory (5 min) ✅
```

## 🔍 Monitoring

### Tjek Status
```bash
./check-sync-status.sh 2025-10-13 2025-10-13
```

### Live Monitoring
```bash
./live-sync-monitor.sh
```

### Tjek Failed Jobs
```sql
SELECT shop, start_date, object_type, error_message, records_processed
FROM bulk_sync_jobs
WHERE status = 'failed'
  AND start_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY start_date DESC, shop;
```

## ⚠️ Vigtige Forskelle: NY vs GAMMEL Logik

### GAMMEL Logik (før 2025-10-13)
```
Refunds sync:
  - Søgte efter: ordrer created i dag
  - Problem: Missede refunds for gamle ordrer
  - Eksempel: Ordre fra 2025-08-01 får refund 2025-10-13
    → Blev IKKE fanget i daglig sync! ❌
```

### NY Logik (efter 2025-10-13) ✨
```
Refunds sync:
  - Søger efter: refunds created i dag (uanset order.created_at)
  - Løsning: Fanger alle refunds created i dag
  - Eksempel: Ordre fra 2025-08-01 får refund 2025-10-13
    → Bliver fanget i sync for 2025-10-13! ✅
```

### Konsekvens for Historisk Data
```
Problem: Refunds syncet før 2025-10-13 mangler data
Løsning: Kør legacy-sync-refunds for historiske datoer
```

## 🛠️ Manuel Sync

### Daglige Transaktionsdata (Orders, SKUs, Refunds, Shipping Discounts)
```bash
# Sync alle daglige data for én dag
./sync-complete.sh 2025-10-13 2025-10-13
```

### Fulfillments
```bash
# Sync leveringsdata for alle shops
./sync-fulfillments.sh 2025-10-01 2025-10-07
```

### Inventory (Lager)
```bash
# Sync lagerstatus for ét shop
VERCEL_TOKEN="bda5da3d49fe0e7391fded3895b5c6bc"
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=pompdelux-da.myshopify.com&type=inventory"
```

### Product Metadata (Alle Valutaer)
```bash
# Sync alle metadata tabeller parallelt (DKK, EUR, CHF)
./sync-metadata.sh

# Eller sync individuelt:
./sync-metadata-paginated.sh pompdelux-da.myshopify.com dkk
./sync-metadata-paginated.sh pompdelux-de.myshopify.com eur
./sync-metadata-paginated.sh pompdelux-chf.myshopify.com chf
```

### Sync Kun Refunds (Stor Dag)
```bash
./run-batch-refunds-sync.sh pompdelux-da.myshopify.com 2025-08-07 updated_at
```

### Sync Historiske Refunds (Gammel Logik)
```bash
./run-batch-refunds-sync.sh pompdelux-da.myshopify.com 2025-08-07 created_at
```

## 📈 Performance

### Daglige Transaktionsdata (per shop, 1 dag)
- **Orders**: 2-3 minutter
- **SKUs**: 3-5 minutter
- **Refunds**: 30 sekunder - 5 minutter (afhænger af antal refunds)
- **Shipping Discounts**: 1-2 minutter
- **Fulfillments**: 2-5 minutter

### Store Dage (800+ ordrer)
- **Orders**: Samme (Bulk API håndterer det)
- **SKUs**: Samme (Bulk API håndterer det)
- **Refunds**: Batch processing (50 ordrer ad gangen)
  - 800 ordrer = 16 batches × 30 sek = 8 minutter
- **Shipping Discounts**: ~4-5 minutter

### Lager & Metadata (uafhængig af daglig sync)
- **Inventory**: 5-10 minutter per shop (~25-50 min total)
- **Product Metadata (DKK)**: 10-20 minutter
- **Product Metadata (EUR)**: 10-20 minutter
- **Product Metadata (CHF)**: 10-20 minutter
- **Total metadata sync** (parallel): ~15-20 minutter

### Total Tid (5 shops, normal dag)
**Daglige transaktionsdata:**
- **Best case**: ~15 minutter
- **Typical**: ~20-30 minutter
- **Worst case** (mange refunds): ~45 minutter

**Fulfillments** (parallel): ~2-5 minutter
**Metadata** (ugentligt, parallel): ~15-20 minutter
**Inventory** (on-demand): ~25-50 minutter

## 🚨 Troubleshooting

### "Jobs stuck as failed"
→ Kør: `./test-auto-validate.sh` (marker empty days som completed)

### "Refunds missing for old orders"
→ Kør: `./run-batch-refunds-sync.sh <shop> <date> updated_at`

### "Large day timeout"
→ batch-sync-refunds håndterer dette automatisk (processerer i batches)
→ Batch system processer 50 ordrer ad gangen og gemmer progress
→ Kan kaldes gentagne gange indtil færdig
→ Continue-orchestrator håndterer automatisk multi-batch jobs

### "Batch sync stuck på samme ordrer"
→ FIXED (2025-10-13): Script passerer nu jobId mellem iterationer
→ Gamle jobs uden jobId skal genstartes: `./run-batch-refunds-sync.sh <shop> <date> <mode>`

### "Missing data in dashboard"
→ Tjek:
1. Er alle transaktionstyper syncet? (orders, skus, refunds, shipping-discounts, fulfillments)
2. Brug `created_at_original` for SKU filtering (ikke `created_at`)
3. Er metadata opdateret? (product_metadata, product_metadata_eur, product_metadata_chf)

### "Monitor batch job progress"
→ Kør: `./monitor-batch-job.sh <job-id>`
→ Eller query: `SELECT status, records_processed, error_message FROM bulk_sync_jobs WHERE id = '<job-id>'`

## 📝 Opsummering

**Dagligt Flow - Transaktionsdata:**
1. Kl. 02:00: Orchestrator opretter jobs for i går (orders, skus, refunds, shipping-discounts)
2. Kl. 02:05+: Continue-orchestrator processer jobs (hvert 5. minut)
3. Orders + SKUs synces først
4. Refunds + Shipping Discounts opdaterer derefter
5. Auto-validate rydder op i false failures
6. Kl. 02:30-03:00: Transaktionsdata færdigt ✅

**Dagligt Flow - Fulfillments:**
7. Kl. 08:00: Leveringsdata synces for alle shops (parallel)
8. ~2-5 minutter: Fulfillments færdigt ✅

**Ugentligt Flow - Metadata:**
9. Hver onsdag kl. 03:00: Produktpriser og metadata synces (parallel)
10. ~15-20 minutter: Metadata færdigt ✅

**On-Demand - Inventory:**
11. Ved behov: Lagerstatus synces per shop eller alle shops

**Vigtigste Features:**
- ✅ Refunds søger nu på refund.created_at (ikke order.created_at)
- ✅ Batch processing for store dage (ingen timeout)
- ✅ Auto-validation af failed jobs (empty days)
- ✅ Continue-orchestrator håndterer multi-batch jobs automatisk
- ✅ Fulfillments, inventory og metadata har INGEN afhængigheder til orders
- ✅ Parallel execution for metadata og fulfillments (hurtigere sync)
