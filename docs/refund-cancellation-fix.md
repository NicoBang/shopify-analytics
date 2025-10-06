# Refund vs. Cancellation Fix

**Dato:** 2025-10-06
**Status:** ✅ Implementeret, afventer validering

## 🐛 Problem

Dashboard viste identisk Brutto- og Nettoomsætning for oktober 2025, selvom der var refunds.

### Root Cause
1. **Felt-forvirring**: `bulk-sync-refunds` opdaterede fejlagtigt `cancelled_amount_dkk` i stedet for et dedikeret refund-felt
2. **Manglende beregning**: Dashboard trak ikke refunded amounts fra nettoomsætningen
3. **Inkonsistent data**: Order 7825660805454 havde `cancelled_qty=0` men `cancelled_amount_dkk=179` (fra refund)

## ✅ Løsning

### 1. Database Schema
**Ny kolonne:** `refunded_amount_dkk`
```sql
ALTER TABLE skus ADD COLUMN refunded_amount_dkk NUMERIC DEFAULT 0;
```

**Feltdefinitioner:**
- `cancelled_amount_dkk`: Beløb for ordrelinjer annulleret **før** forsendelse
- `refunded_amount_dkk`: Beløb tilbageført **efter** ordre er oprettet/sendt
- `cancelled_qty`: Antal enheder annulleret før forsendelse
- `refunded_qty`: Antal enheder refunderet efter forsendelse

### 2. Edge Function (bulk-sync-refunds)
**Før:**
```typescript
cancelled_amount_dkk: refund.cancelled_amount_dkk  // ❌ FORKERT
```

**Efter:**
```typescript
refunded_amount_dkk: refund.refunded_amount_dkk    // ✅ KORREKT
```

### 3. Dashboard Beregning (api/analytics.js)
**Ny logik:**
```javascript
// Bruttoomsætning = total_price_dkk - cancelled_amount_dkk
const bruttoRevenue = totalPrice - cancelledAmount;

// Nettoomsætning = bruttoomsætning - refunded_amount_dkk
shopMap[shop].nettoomsætning += bruttoRevenue;
if (hasRefundInPeriod) {
  shopMap[shop].nettoomsætning -= refundedAmount;
}
```

**Ny response:**
```json
{
  "shop": "pompdelux-da.myshopify.com",
  "stkBrutto": 150,
  "stkNetto": 145,
  "returQty": 5,
  "bruttoomsætning": 12500.00,
  "nettoomsætning": 12100.00,
  "refundedAmount": 400.00
}
```

## 🧪 Validering

### Forventet resultat for ordre 7825660805454:
```
order_id: 7825660805454
cancelled_qty: 0
cancelled_amount_dkk: 0       (nulstillet fra 179)
refunded_qty: [antal fra Shopify]
refunded_amount_dkk: 179      (flyttet hertil)
```

### Dashboard forventet resultat:
- **Bruttoomsætning** ≠ **Nettoomsætning** (forskellen = refundedAmount)
- **returQty** > 0 hvis der er refunds i perioden

## 📋 Implementerings-skridt

1. ✅ Opret migration: `supabase/migrations/*_add_refunded_amount_dkk.sql`
2. ✅ Opdater `bulk-sync-refunds/index.ts` interface og update logik
3. ✅ Opdater `api/analytics.js` Dashboard-beregning
4. ⏳ Apply migration til database
5. ⏳ Deploy opdateret Edge Function
6. ⏳ Re-sync refunds for oktober 2025
7. ⏳ Verificer Dashboard viser korrekt Brutto ≠ Netto

## 🔧 Test Commands

```bash
# Run full test suite
./scripts/test-refund-fix.sh

# Manual verification
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-production.vercel.app/api/analytics?startDate=2025-10-01&endDate=2025-10-31&type=dashboard-sku"
```

## 📊 Metrics

**Før fix:**
- Bruttoomsætning = Nettoomsætning (fejl)
- cancelled_amount_dkk indeholdt både cancellations og refunds

**Efter fix:**
- Bruttoomsætning > Nettoomsætning (korrekt)
- cancelled_amount_dkk = kun cancellations
- refunded_amount_dkk = kun refunds

## 🚨 Bemærkninger

- Data cleanup migration nulstiller `cancelled_amount_dkk` hvor `cancelled_qty=0`
- Historisk data skal re-synces for korrekte værdier
- Dashboard API returnerer nu 3 beløb: bruttoomsætning, nettoomsætning, refundedAmount
