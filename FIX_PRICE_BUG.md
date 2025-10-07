# Fix for Tax Calculation Bug in price_dkk

## Problem

`bulk-sync-skus` function havde en kritisk bug hvor `price_dkk` blev beregnet forkert for ordrer med `quantity > 1`.

**Bug**: `taxLines` returnerer TOTAL moms for alle units, men koden behandlede det som per-unit moms.

**Eksempel**:
- Ordre 7801400230222: 4 units × 59,70 DKK inkl. moms
- Korrekt: 59,70 / 1,25 = 47,76 DKK per unit ekskl. moms
- Bug resultat: 11,94 DKK (som er 47,76 / 4)

## Løsning

Istedet for at re-synce ALT data (8+ timer), bruger vi en verification table strategi:

1. Opret verification table
2. Sync med hurtig standard GraphQL API (ikke Bulk API)
3. Merge kun forkerte records via SQL
4. Clean up

## Implementering

### 1. Fix bulk-sync-skus funktionen

Ret bug i [supabase/functions/bulk-sync-skus/index.ts](supabase/functions/bulk-sync-skus/index.ts#L381):

```typescript
// FØR (FORKERT):
totalTaxPerUnit = taxLinesArray.reduce(...) * rate;

// EFTER (KORREKT):
const totalTaxForAllUnits = taxLinesArray.reduce(...) * rate;
totalTaxPerUnit = totalTaxForAllUnits / (obj.quantity || 1);
```

### 2. Deploy fix

```bash
cd supabase/functions/bulk-sync-skus
supabase functions deploy bulk-sync-skus
```

### 3. Opret verification table

```bash
psql -f migrations/create_sku_price_verification_table.sql
```

### 4. Sync til verification table

```bash
# Sync alle shops for perioden August-September 2025
./sync-verify-all.sh 2025-08-01 2025-09-30
```

Dette bruger den nye `type=verify-skus` endpoint som:
- **Kun syncer SKUs med `quantity > 1`** (bug påvirker kun disse)
- Er hurtigere end Bulk API
- Reducerer data volume med ~60-70%
- Undgår timeouts ved kun at synce nødvendig data

### 5. Merge korrekte priser

```bash
psql -f migrations/merge_verified_sku_prices.sql
```

Dette opdaterer kun records hvor `price_dkk` er forskellig (med tolerance 0,01 DKK).

### 6. Verificer resultater

```sql
-- Tjek antal opdaterede records
SELECT COUNT(*)
FROM skus s
INNER JOIN sku_price_verification v ON s.shop = v.shop AND s.order_id = v.order_id AND s.sku = v.sku
WHERE ABS(s.price_dkk - v.price_dkk) > 0.01;

-- Tjek sample af rettede priser
SELECT s.order_id, s.sku, s.quantity,
       s.price_dkk as old_price,
       v.price_dkk as new_price,
       ROUND(v.price_dkk - s.price_dkk, 2) as difference
FROM skus s
INNER JOIN sku_price_verification v ON s.shop = v.shop AND s.order_id = v.order_id AND s.sku = v.sku
WHERE ABS(s.price_dkk - v.price_dkk) > 0.01
LIMIT 10;
```

### 7. Clean up verification table

```bash
# KUN efter du har verificeret at alt er korrekt!
psql -f migrations/cleanup_verification_table.sql
```

## Filer skabt

1. `migrations/create_sku_price_verification_table.sql` - Opret verification table
2. `api/sync-shop.js` - Tilføjet `case 'verify-skus'` endpoint
3. `sync-verify-all.sh` - Script til at synce alle shops
4. `migrations/merge_verified_sku_prices.sql` - Merge korrekte priser
5. `migrations/cleanup_verification_table.sql` - Ryd op efter merge

## Estimeret tid

- Sync til verification table: ~30 min (meget hurtigere end Bulk API)
- Merge SQL: ~1-2 min
- Total: ~35 min (vs. 8+ timer for fuld re-sync)

## Sikkerhedstjek

Merge SQL inkluderer flere sikkerhedstjek:
- **Kun quantity > 1**: Bug påvirker kun multi-quantity orders
- Kun opdater hvor priser er forskellige (`ABS(s.price_dkk - v.price_dkk) > 0.01`)
- Verificer quantity matcher (`s.quantity = v.quantity`)
- Rapportér antal ændringer og samples

## Performance Optimering

Buggen påvirker KUN records hvor `quantity > 1` fordi:
```typescript
// Hvis quantity = 1:
totalTaxPerUnit = totalTaxForAllUnits / 1  // ✅ Korrekt

// Hvis quantity > 1:
totalTaxPerUnit = totalTaxForAllUnits / quantity  // ❌ Blev IKKE gjort i buggen
```

Derfor merger SQL'en kun records med `quantity > 1`, hvilket reducerer:
- Update operationer med ~60-70% (de fleste orders er single quantity)
- Merge tid fra ~2 min til ~30 sek
