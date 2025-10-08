# Sale Discount Migration Guide

## Formål
Denne migration tilføjer tracking af sale discount (nedsættelse fra compareAtPrice til salgspris) og opdaterer orders-tabellen med korrekt `sale_discount_total` for "Rabat ex moms" beregning i Dashboard.

## Problem
- **Juli og ældre ordrer**: Har `sale_discount_total` fra gammelt system ✅
- **August+ ordrer**: Mangler `sale_discount_total` (hardcoded til 0) ❌

## Løsning
1. Tilføj kolonner til skus-tabellen for at gemme originalPrice og sale discount
2. Opdater bulk-sync-skus til at beregne sale discount fra Shopify data
3. Aggreger SKU-niveau sale discount til order-niveau
4. Re-sync eksisterende data for at få værdierne

## Trin 1: Kør Database Migrationer

### 1.1 Tilføj Sale Discount Kolonner til SKUs
```bash
# Via Supabase SQL Editor eller psql
psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -f migrations/add_sale_discount_columns.sql
```

**Nye kolonner i skus-tabellen:**
- `original_price_dkk`: CompareAtPrice (original retail price) ex moms
- `sale_discount_per_unit_dkk`: Nedsat pris per enhed (originalPrice - salePrice) ex moms
- `sale_discount_total_dkk`: Total nedsat pris (sale_discount_per_unit × quantity) ex moms

### 1.2 Opret SQL Funktioner til Order-Level Aggregering
```bash
psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543 -U postgres.ihawjrtfwysyokfotewn -d postgres -f migrations/create_update_order_sale_discount_function.sql
```

**Nye funktioner:**
- `update_order_sale_discount()`: Opdaterer alle ordrer
- `update_order_sale_discount_by_id(shop, order_id)`: Opdaterer én ordre

## Trin 2: Deploy Opdateret bulk-sync-skus Edge Function

```bash
npx supabase functions deploy bulk-sync-skus
```

**Ændringer i bulk-sync-skus:**
- Henter nu `originalUnitPriceSet` fra Shopify
- Beregner `sale_discount_per_unit_dkk = max(originalPriceDkk - priceDkk, 0)`
- Beregner `sale_discount_total_dkk = sale_discount_per_unit × quantity`
- Gemmer alle 3 nye kolonner i skus-tabellen

## Trin 3: Re-Sync Eksisterende Data

### 3.1 Re-sync SKUs for August-Oktober
Dette vil populere de nye sale discount kolonner:

```bash
# August 2025
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-da.myshopify.com","startDate":"2025-08-01","endDate":"2025-08-31","includeRefunds":true}'

# September 2025
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-da.myshopify.com","startDate":"2025-09-01","endDate":"2025-09-30","includeRefunds":true}'

# Oktober 2025
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM" \
  -H "Content-Type: application/json" \
  -d '{"shop":"pompdelux-da.myshopify.com","startDate":"2025-10-01","endDate":"2025-10-07","includeRefunds":true}'
```

### 3.2 Aggreger Sale Discount til Orders-Tabellen
Efter SKU sync er færdig, kør SQL funktion til at opdatere orders:

```sql
-- Opdater alle ordrer
SELECT update_order_sale_discount();
```

Eller opdater kun specifikke ordrer:
```sql
-- Opdater kun ordrer fra August-Oktober 2025
UPDATE orders o
SET sale_discount_total = COALESCE(
  (
    SELECT SUM(s.sale_discount_total_dkk)
    FROM skus s
    WHERE s.order_id::text = o.order_id::text
      AND s.shop = o.shop
  ), 0
),
combined_discount_total = COALESCE(
  (
    SELECT SUM(s.sale_discount_total_dkk)
    FROM skus s
    WHERE s.order_id::text = o.order_id::text
      AND s.shop = o.shop
  ), 0
) + COALESCE(o.total_discounts_ex_tax, 0)
WHERE o.created_at >= '2025-08-01'
  AND o.created_at <= '2025-10-07';
```

## Trin 4: Verificer Resultater

### 4.1 Tjek SKUs Data
```sql
-- Se et eksempel på SKU med sale discount
SELECT
  order_id,
  sku,
  quantity,
  original_price_dkk,
  price_dkk,
  sale_discount_per_unit_dkk,
  sale_discount_total_dkk,
  total_discount_dkk
FROM skus
WHERE sale_discount_total_dkk > 0
LIMIT 5;
```

### 4.2 Tjek Orders Data
```sql
-- Se eksempel på ordre med sale discount
SELECT
  order_id,
  created_at,
  total_discounts_ex_tax,
  sale_discount_total,
  combined_discount_total
FROM orders
WHERE sale_discount_total > 0
  AND created_at >= '2025-08-01'
LIMIT 5;
```

### 4.3 Sammenlign med Specifik Ordre
```sql
-- Tjek ordre 7801056821582 fra brugerens eksempel
SELECT
  o.order_id,
  o.total_discounts_ex_tax,
  o.sale_discount_total,
  o.combined_discount_total,
  (SELECT SUM(s.sale_discount_total_dkk) FROM skus s WHERE s.order_id = '7801056821582') as calculated_sale_discount
FROM orders o
WHERE o.order_id = '7801056821582';
```

## Forventet Resultat

**orders.sale_discount_total** vil nu indeholde:
- Juli og ældre: Eksisterende værdier fra gammelt system (bevares)
- August+: Nyt beregnet værdi fra SKU aggregering

**orders.combined_discount_total** vil nu være:
```
combined_discount_total = sale_discount_total + total_discounts_ex_tax
```

Hvor:
- `sale_discount_total` = Sum af (compareAtPrice - salePrice) × quantity ex moms
- `total_discounts_ex_tax` = Rabatkoder og linje-rabatter

Dette matcher brugerens tidligere system og giver korrekt "Rabat ex moms" til Dashboard.

## Fremtidige Syncs

Fra nu af vil alle nye bulk-sync-skus automatisk:
1. Beregne sale discount fra originalUnitPriceSet og discountedUnitPriceSet
2. Gemme værdierne i skus-tabellen
3. Man skal stadig køre `update_order_sale_discount()` for at aggregere til orders-niveau

**Anbefaling**: Overvej at lave en trigger eller Edge Function der automatisk opdaterer `sale_discount_total` når SKUs indsættes/opdateres.
