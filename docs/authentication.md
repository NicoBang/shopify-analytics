# Authentication Flow

## Overview

Shopify Analytics uses Supabase Edge Functions with JWT-based authentication for secure function-to-function communication.

## Authentication Architecture

### External Requests (Client → Edge Function)

**Required Header:**
```http
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
```

**Key Types:**
- **anon key** (public): For client-side requests with Row Level Security (RLS) enforcement
- **service_role key** (secret): For server-side requests, bypasses RLS

**Get Keys:**
1. Navigate to: https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/settings/api
2. Copy `anon` key (public) or `service_role` key (secret)

### Internal Requests (Edge Function → Edge Function)

**Flow:**
```
bulk-sync-skus → bulk-sync-refunds
```

**Implementation:**
```typescript
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const response = await fetch(`${supabaseUrl}/functions/v1/bulk-sync-refunds`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ shop, startDate, endDate }),
});
```

## Environment Variables

Edge Functions automatically have access to:
- `SUPABASE_URL`: Project URL (e.g., https://ihawjrtfwysyokfotewn.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY`: Secret key for internal function calls
- `SUPABASE_ANON_KEY`: Public key for client-side requests

**Note:** These are **automatically injected** by Supabase platform. No manual configuration needed.

## JWT Structure

Supabase JWTs follow this format:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.PAYLOAD.SIGNATURE
```

- **Header**: Algorithm and type (base64-encoded)
- **Payload**: Claims including role, iss, ref, iat, exp (base64-encoded)
- **Signature**: HMAC-SHA256 hash of header + payload + secret

**Example payload (service_role):**
```json
{
  "iss": "supabase",
  "ref": "ihawjrtfwysyokfotewn",
  "role": "service_role",
  "iat": 1727694040,
  "exp": 2043270040
}
```

## Security Best Practices

### ✅ Do:
- Use `service_role` key for function-to-function communication
- Store keys in environment variables (never in code)
- Use `anon` key for client-side requests with RLS
- Validate JWT expiration (`exp` claim)

### ❌ Don't:
- Expose `service_role` key in client-side code
- Hardcode keys in source files
- Use custom API keys instead of Supabase JWTs
- Disable JWT verification in production

## Testing

### Local Development

**Option 1: Direct curl**
```bash
# Get service_role key from dashboard
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

**Option 2: Test script**
```bash
# Use helper script (recommended)
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..." ./scripts/test-orchestration.sh
```

### Production

Edge Functions use platform-managed JWT validation:
1. Request hits Supabase API Gateway
2. Gateway validates JWT signature and expiration
3. If valid, request forwarded to Edge Function
4. Function receives request (no additional auth needed)

## Troubleshooting

### "Invalid JWT" Error

**Cause:** JWT signature doesn't match expected secret or token is expired

**Solutions:**
1. Verify you're using the correct key from Supabase dashboard
2. Check JWT hasn't expired (`exp` claim)
3. Ensure no extra spaces or formatting in Authorization header
4. Confirm you're using `Bearer <token>` format

**Example:**
```bash
# ❌ Wrong
Authorization: eyJhbGc...

# ✅ Correct
Authorization: Bearer eyJhbGc...
```

### "Unauthorized" Error from Function Code

**Cause:** Custom authorization logic within function rejected request

**Solution:** Check function logs for specific error details

### Function-to-Function Communication Fails

**Debug checklist:**
1. Verify `SUPABASE_SERVICE_ROLE_KEY` environment variable is set in calling function
2. Check function logs for HTTP errors or timeouts
3. Ensure target function URL is correct: `${SUPABASE_URL}/functions/v1/<function-name>`
4. Confirm both functions are deployed to same Supabase project

## Migration Notes

### Previous Implementation (Deprecated)

**Old approach:** Custom API key validation using `FUNCTIONS_INVOKER_KEY` or `API_SECRET_KEY`

**Issues:**
- Platform-level JWT validation always ran first
- Custom keys were not valid JWTs
- Required disabling `verify_jwt` (security risk)

**Migration:** Removed all custom auth checks. Now relying solely on Supabase's built-in JWT validation.

## Reference

- [Supabase JWT Documentation](https://supabase.com/docs/guides/auth/jwts)
- [Edge Functions Auth](https://supabase.com/docs/guides/functions/auth)
- [Project API Settings](https://supabase.com/dashboard/project/ihawjrtfwysyokfotewn/settings/api)
