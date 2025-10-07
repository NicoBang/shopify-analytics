# Shopify Analytics Sync Manual

Komplet guide til at synce Shopify data til Supabase.

---

## 📋 Oversigt

**Tre typer syncs:**
1. **Orders & SKUs** - Syncer ordrer og SKU data baseret på `created_at`
2. **Refund Orders** - Syncer ordrer med refunds baseret på `updated_at`
3. **Orchestrator** - Automatisk sync af alle shops for en periode

---

## 🚀 Quick Start

### Sync en periode (normale ordrer)
```bash
./sync-date-range.sh 2025-10-01 2025-10-07
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
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-refund-orders" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-09-01",
    "endDate": "2025-09-30"
  }'
```

---

## ⚠️ Troubleshooting

### Orchestrator stopper efter 30 min
**Problem:** Orchestrator har ~6-7 min Edge Function timeout.

**Løsning:**
- Kør orchestrator igen - den springer completed jobs over
- Eller sync manuelt de manglende datoer

### Jobs står fast som "running"
**Problem:** Edge Function timeout har dræbt job, men status er ikke opdateret.

**Løsning:**
```bash
./cleanup-stale-jobs.sh
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

Alle scripts bruger:
```bash
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"
```

---

## 📝 Quick Reference Card

| Task | Command |
|------|---------|
| Full sync (created_at) | `./sync-date-range.sh START END` |
| Refund sync (updated_at) | `./sync-date-range-refunds.sh START END` |
| Check status | `./check-sync-status.sh START END` |
| Retry failed | `./retry-failed-jobs.sh` |
| Cleanup stale | `./cleanup-stale-jobs.sh` |
| Single order sync | `bulk-sync-orders` + curl |
| Single SKU sync | `bulk-sync-skus` + curl |
| Manual refund sync | `bulk-sync-refund-orders` + curl |
