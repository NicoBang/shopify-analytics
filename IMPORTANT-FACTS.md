# KRITISKE FAKTA - LÆS DETTE FØRST! ⚠️

## Database-tilstand (verificeret 2025-10-02)

### ✅ KORREKT: SKUs-tabellen HAR cancelled_qty værdier

**Bekræftet fra skus_rows (10).csv**:
- Order `6181218910542`: SKUs har `cancelled_qty = 1`
- Order `6181221204302`: SKUs har `cancelled_qty = 1` eller `2`
- **SKUs-tabellen er KORREKT opdateret med cancelled_qty!**

### ✅ KORREKT: Orders-tabellen HAR cancelled_qty værdier

**Bekræftet fra analytics API**:
- Order `6181290639694`: `cancelled_qty = 2`
- **Orders-tabellen er KORREKT opdateret med cancelled_qty!**

### ✅ KORREKT: Color_Analytics BRUGER cancelled_qty

**Bekræftet fra metadata API 2024-09-30**:
- Total solgt: 1,285 (IKKE 1,319)
- Total cancelled: 34
- **metadata.js fratrækker korrekt cancelled fra quantity!**

## ✅ LØST: Aktuelle diskrepans (2024-09-30)

| Kilde | Item Count | Cancelled | Brutto | Forskel |
|-------|-----------|-----------|--------|---------|
| Dashboard (orders) | 1,319 | 41 | 1,278 | - |
| Color_Analytics (skus) | 1,319 | 34 | 1,285 | +7 |
| Forventet (Opus) | 1,319 | 41 | 1,278 | - |

**ROOT CAUSE IDENTIFICERET** ✅:
- Dashboard (orders table): 41 cancelled items ✅
- **SKUs table HAR ALLE 41 cancelled items** ✅ (bekræftet fra user's CSV)
- Color_Analytics viser: 34 cancelled items ❌
- **Difference: 7 items tælles IKKE med i Color_Analytics aggregering**

**BEKRÆFTET DATA** (fra user's CSV):
- 35 SKU rows med cancelled_qty > 0 for 2024-09-30
- Total cancelled fra SKUs: 41 items (exact match med orders table)
- Eksempler:
  - Order 6181221204302: 11 SKUs med cancelled_qty = 1-2
  - Order 6181259641166: 14 SKUs med cancelled_qty = 1-2
  - Order 6404699488522: 2 SKUs med cancelled_qty = 2
  - Osv.

**ROOT CAUSE - DATA RE-SYNC PROBLEM** ✅:
1. **User's CSV er KORREKT** (41 cancelled items fra før re-sync)
2. **Database blev re-synced 2025-10-01 kl. 19:54** (orders.updated_at bekræfter)
3. **Re-sync MISTEDE 7 cancelled items** for 2024-09-30
4. **Current database har kun 34 cancelled** (7 SKUs mangler eller har cancelled_qty=0)

**BEVIS**:
- Order 6181221204302 havde 11 cancelled SKUs i CSV
- Order 6181221204302 har 0 SKUs i current database for 2024-09-30
- Orders table viser stadig 41 cancelled (ikke re-synced)
- SKUs table viser kun 34 cancelled (blev re-synced og mistede data)

**PROBLEM I `/api/sync-shop.js`** ✅ IDENTIFICERET:
- **Line 76**: GraphQL query mangler status filter → `const queryFilter = \`${dateField}:>=${isoStart} ${dateField}:<=${isoEnd}\``
- **Problem**: Shopify GraphQL filtrerer implicit cancelled orders ud (refund amount = $0)
- **Bevis**: Fulfillments query (line 587) HAR status filter: `fulfillment_status:fulfilled`
- **Resultat**: Re-sync af historisk data mister cancelled orders (7 items mangler for 2024-09-30)
- **Løsning**: Tilføj explicit filter for at inkludere ALLE ordrer uanset status

## VIGTIG REMINDER

**GØR ALDRIG DETTE IGEN**:
- ❌ Antag at SKUs-tabellen mangler cancelled_qty
- ❌ Lav SQL fix-scripts uden at verificere data først
- ❌ Ignorer brugerens bekræftelse af data-tilstand

**GØR ALTID DETTE**:
- ✅ Verificer data-tilstand via API calls FØRST
- ✅ Sammenlign aggregeringer mellem forskellige endpoints
- ✅ Tjek for dato-filter eller shop-filter forskelle
- ✅ Lyt til brugeren når de bekræfter data-tilstand
