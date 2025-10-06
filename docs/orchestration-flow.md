# Orchestration Flow: bulk-sync-skus → bulk-sync-refunds

## Overview

Sequential orchestration mellem Edge Functions for at synkronisere SKU data og refunds i én request.

## Architecture

```
Client Request (includeRefunds: true)
    ↓
bulk-sync-skus
    ├─ Sync SKUs via Shopify GraphQL Bulk API
    ├─ Upsert SKUs til Supabase
    └─ Call bulk-sync-refunds (internal)
        ├─ Hent refunds via Shopify REST API
        ├─ Update SKUs med refund data
        └─ Return stats
    ↓
Combined Response
```

## Request Flow

### 1. Client → bulk-sync-skus

**Endpoint:**
```
POST https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus
```

**Headers:**
```http
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

**Body:**
```json
{
  "shop": "pompdelux-da.myshopify.com",
  "startDate": "2024-09-27",
  "endDate": "2024-09-27",
  "objectType": "skus",
  "includeRefunds": true
}
```

### 2. bulk-sync-skus → bulk-sync-refunds

**Trigger:** `includeRefunds: true` flag

**Implementation:**
```typescript
if (includeRefunds) {
  const refundSyncResult = await syncRefunds(shop, startDate, endDate);

  return {
    success: true,
    skuSync: skuSyncResult,
    refundSync: refundSyncResult
  };
}
```

**Internal Request:**
```typescript
const response = await fetch(`${supabaseUrl}/functions/v1/bulk-sync-refunds`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ shop, startDate, endDate })
});
```

### 3. Response Structure

**Success (med refunds):**
```json
{
  "success": true,
  "skuSync": {
    "success": true,
    "results": [
      {
        "date": "2024-09-27",
        "inserted": 150,
        "updated": 25
      }
    ]
  },
  "refundSync": {
    "refundsProcessed": 5,
    "skusUpdated": 5
  }
}
```

**Success (uden refunds):**
```json
{
  "success": true,
  "results": [
    {
      "date": "2024-09-27",
      "inserted": 150,
      "updated": 25
    }
  ]
}
```

**Error:**
```json
{
  "success": false,
  "stage": "refunds",
  "skuSync": { ... },
  "refundError": "Error message"
}
```

## Error Handling

### SKU Sync Fejler

```json
{
  "error": "Failed to sync SKUs: ...",
  "stage": "skus"
}
```

**Handling:** SKU sync fejler før refund sync kaldes. Ingen refunds processeres.

### Refund Sync Fejler

```json
{
  "success": false,
  "stage": "refunds",
  "skuSync": { "success": true, ... },
  "refundError": "Refund sync failed: ..."
}
```

**Handling:** SKUs er synkroniseret, men refunds fejlede. Response inkluderer både success og error data.

## Environment Variables

Begge funktioner kræver:

```bash
SUPABASE_URL=https://ihawjrtfwysyokfotewn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SHOPIFY_TOKEN_DA=shpat_...
SHOPIFY_TOKEN_DE=shpat_...
SHOPIFY_TOKEN_NL=shpat_...
SHOPIFY_TOKEN_INT=shpat_...
SHOPIFY_TOKEN_CHF=shpat_...
```

**Note:** Environment variables er defineret i `.env` filer i hver function mappe og deployes automatisk.

## Testing

### Manual Test

```bash
# Hent service_role key fra Supabase dashboard først
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."

curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2024-09-27",
    "endDate": "2024-09-27",
    "objectType": "skus",
    "includeRefunds": true
  }'
```

### Automated Test Script

```bash
# Brug test script
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..." ./scripts/test-orchestration.sh
```

**Test scenarios:**

1. **Happy path (med refunds):**
   ```bash
   TEST_INCLUDE_REFUNDS=true ./scripts/test-orchestration.sh
   ```

2. **Uden refunds:**
   ```bash
   TEST_INCLUDE_REFUNDS=false ./scripts/test-orchestration.sh
   ```

3. **Custom date range:**
   ```bash
   TEST_START_DATE="2024-09-01" \
   TEST_END_DATE="2024-09-30" \
   TEST_INCLUDE_REFUNDS=true \
   ./scripts/test-orchestration.sh
   ```

## Production Usage

### Full Historical Sync

For at synkronisere hele september-oktober 2025 med refunds:

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "pompdelux-da.myshopify.com",
    "startDate": "2025-09-01",
    "endDate": "2025-10-31",
    "objectType": "skus",
    "includeRefunds": true
  }'
```

### Per-Shop Sync

For at synkronisere alle shops:

```bash
for shop in pompdelux-da pompdelux-de pompdelux-nl pompdelux-int pompdelux-chf; do
  echo "Syncing $shop..."
  curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/bulk-sync-skus" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"shop\": \"$shop.myshopify.com\",
      \"startDate\": \"2025-09-01\",
      \"endDate\": \"2025-10-31\",
      \"objectType\": \"skus\",
      \"includeRefunds\": true
    }"
  sleep 5
done
```

## Performance Considerations

### Timing

- **SKU Sync:** ~2-5 min per dag (afhænger af antal ordrer)
- **Refund Sync:** ~30 sek per dag (færre refunds end ordrer)
- **Total:** ~2.5-5.5 min per dag med refunds

### Rate Limiting

- **Shopify GraphQL Bulk API:** 1 concurrent operation per shop
- **Shopify REST API:** 2 requests/sekund (500ms delay mellem calls)
- **Supabase Edge Functions:** 30 sek timeout default

### Recommendations

- Sync maksimalt 7 dage per request for at undgå timeouts
- Brug `includeRefunds: true` kun når nødvendigt
- Monitorer function logs for performance issues

## Monitoring

### Success Indicators

✅ **SKU Sync:**
- `skuSync.success === true`
- `results[].inserted + results[].updated > 0`

✅ **Refund Sync:**
- `refundSync.refundsProcessed >= 0`
- `refundSync.skusUpdated >= 0`

### Error Indicators

❌ **SKU Sync failed:**
- `error` field present
- `stage === "skus"`

❌ **Refund Sync failed:**
- `success === false`
- `stage === "refunds"`
- `refundError` field present

## Troubleshooting

### "Invalid JWT"

**Årsag:** Forkert eller udløbet service_role key

**Løsning:** Hent ny key fra https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/settings/api

### Refund sync timeout

**Årsag:** For mange dage i ét request

**Løsning:** Split date range i mindre chunks (max 7 dage)

### SKUs not updated with refund data

**Årsag:** Refund sync kørte men fandt ingen refunds

**Check:**
1. Verificer at ordrer har refunds i Shopify
2. Check Supabase logs: `supabase functions logs bulk-sync-refunds`
3. Kør bulk-sync-refunds direkte for at debugge

## Related Documentation

- [Authentication Flow](./authentication.md)
- [bulk-sync-skus README](../supabase/functions/bulk-sync-skus/README.md)
- [bulk-sync-refunds README](../supabase/functions/bulk-sync-refunds/README.md)
