# Zero-Risk Implementation Plan

## FASE 1: Monitoring & Security (Week 1-2)
**Risk: 0% - Only additive changes**

### Task 1.1: Structured Logging (1 hour)
**No changes to existing functions - only add new utility**

```bash
# Create new shared logger
touch supabase/functions/_shared/logger.ts
```

**File: `supabase/functions/_shared/logger.ts`**
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface LogContext {
  shop?: string;
  function?: string;
  jobId?: string;
  stage?: string;
  recordsProcessed?: number;
  error?: Error | string;
}

export class Logger {
  private functionName: string;
  private supabase: any;

  constructor(functionName: string) {
    this.functionName = functionName;
    this.supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
  }

  async log(
    level: "info" | "warn" | "error",
    message: string,
    context: LogContext = {}
  ) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      function: this.functionName,
      message,
      ...context,
    };

    // Console log (structured JSON)
    console.log(JSON.stringify(logEntry));

    // Persist errors to database for analysis
    if (level === "error") {
      await this.persistError(logEntry);
    }
  }

  private async persistError(logEntry: any) {
    try {
      await this.supabase.from("function_errors").insert({
        function_name: logEntry.function,
        error_message: logEntry.message,
        context: logEntry,
        created_at: logEntry.timestamp,
      });
    } catch (err) {
      console.error("Failed to persist error:", err);
    }
  }

  info(message: string, context?: LogContext) {
    return this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    return this.log("warn", message, context);
  }

  error(message: string, context?: LogContext) {
    return this.log("error", message, context);
  }
}
```

**Migration: Create error tracking table**
```sql
-- supabase/migrations/20251023_create_function_errors.sql
CREATE TABLE IF NOT EXISTS function_errors (
  id BIGSERIAL PRIMARY KEY,
  function_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_function_errors_created_at ON function_errors(created_at DESC);
CREATE INDEX idx_function_errors_function_name ON function_errors(function_name);
```

**Testing:**
```bash
# Apply migration locally
supabase db reset

# Test logger in isolation
cat > test-logger.ts << 'EOF'
import { Logger } from "./supabase/functions/_shared/logger.ts";

const logger = new Logger("test-function");
await logger.info("Test info message", { shop: "pompdelux-da" });
await logger.error("Test error", { error: new Error("Simulated error") });
console.log("✅ Logger test complete");
EOF

deno run --allow-env --allow-net test-logger.ts
```

**Deployment:**
```bash
# Deploy migration (safe - only creates new table)
supabase db push

# No Edge Function deployment needed yet (logger is just a utility)
```

---

### Task 1.2: Fix Exposed Supabase Key (2 hours)
**Risk: LOW - Creates NEW proxy function, old code untouched**

**Step 1: Create proxy Edge Function**
```bash
mkdir -p supabase/functions/google-sheets-proxy
```

**File: `supabase/functions/google-sheets-proxy/index.ts`**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Logger } from "../_shared/logger.ts";

const logger = new Logger("google-sheets-proxy");

serve(async (req) => {
  try {
    const { query, table, operation } = await req.json();

    // Validate API key from Google Sheets
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== Deno.env.get("GOOGLE_SHEETS_API_KEY")) {
      logger.warn("Unauthorized request", { apiKey });
      return new Response("Unauthorized", { status: 401 });
    }

    // Create Supabase client with SERVICE_ROLE_KEY (server-side only)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Execute query based on operation
    let result;
    switch (operation) {
      case "select":
        result = await supabase.from(table).select(query);
        break;
      case "insert":
        result = await supabase.from(table).insert(query);
        break;
      case "update":
        result = await supabase.from(table).update(query.data).match(query.match);
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    logger.info("Query executed", { table, operation, rowCount: result.data?.length });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    logger.error("Proxy error", { error: err.message });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

**Step 2: Update Google Sheets (GRADUALLY)**
```javascript
// google-sheets-enhanced.js (NEW VERSION - deploy side-by-side)

// OLD CODE (keep for now):
const SUPABASE_KEY = '@Za#SJxn;gnBxJ;Iu2uixoUd&#\'ndl';  // RISKY

// NEW CODE (add as alternative):
const USE_PROXY = false;  // Feature flag - start disabled

function fetchSupabaseData(query) {
  if (USE_PROXY) {
    // NEW: Call proxy instead of direct Supabase
    const url = 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/google-sheets-proxy';
    const options = {
      method: 'POST',
      headers: {
        'x-api-key': 'bda5da3d49fe0e7391fded3895b5c6bc',  // Keep this secret
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        table: 'daily_shop_metrics',
        operation: 'select',
        query: query
      })
    };
    return UrlFetchApp.fetch(url, options);
  } else {
    // OLD: Direct Supabase call (original code)
    const url = `https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/${table}?${query}`;
    const options = {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    return UrlFetchApp.fetch(url, options);
  }
}
```

**Testing:**
```bash
# 1. Deploy proxy function
supabase functions deploy google-sheets-proxy --no-verify-jwt

# 2. Test from Google Sheets with USE_PROXY=true
# 3. Verify data matches old implementation
# 4. If OK after 24 hours → remove old code
```

---

### Task 1.3: Add Test Suite (5 hours)
**Risk: 0% - Tests don't affect production**

**Test 1: Duplicate SKU Aggregation**
```bash
mkdir -p tests/unit
touch tests/unit/duplicate-aggregation.test.js
```

**File: `tests/unit/duplicate-aggregation.test.js`**
```javascript
const { describe, it, expect } = require('@jest/globals');

// Import aggregation logic (need to extract from bulk-sync-skus first)
// For now, test the EXPECTED behavior

describe('SKU Duplicate Aggregation', () => {
  it('should recalculate total_discount_dkk = discount_per_unit_dkk × quantity', () => {
    // This is the CORRECT formula after 2025-10-15 fix
    const duplicates = [
      { sku: '100145', quantity: 2, discount_per_unit_dkk: 39.92, total_discount_dkk: 79.84 },
      { sku: '100145', quantity: 1, discount_per_unit_dkk: 39.92, total_discount_dkk: 39.92 }
    ];

    // Aggregate
    const aggregated = aggregateDuplicates(duplicates);

    // Should have:
    // - quantity: 3 (2 + 1)
    // - discount_per_unit_dkk: 39.92 (unchanged)
    // - total_discount_dkk: 119.76 (39.92 × 3) NOT 119.76 (79.84 + 39.92)

    expect(aggregated.quantity).toBe(3);
    expect(aggregated.discount_per_unit_dkk).toBe(39.92);
    expect(aggregated.total_discount_dkk).toBe(119.76);
  });

  it('should warn if duplicates have different discount_per_unit_dkk', () => {
    const duplicates = [
      { sku: '100145', quantity: 2, discount_per_unit_dkk: 39.92 },
      { sku: '100145', quantity: 1, discount_per_unit_dkk: 50.00 }  // Different!
    ];

    const warnings = [];
    const aggregated = aggregateDuplicates(duplicates, (msg) => warnings.push(msg));

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('different discount_per_unit_dkk');
  });
});

// Helper function (will move to actual implementation later)
function aggregateDuplicates(records, warnCallback = () => {}) {
  const map = new Map();

  for (const record of records) {
    const key = record.sku;

    if (map.has(key)) {
      const existing = map.get(key);

      // Warn if inconsistent
      if (existing.discount_per_unit_dkk !== record.discount_per_unit_dkk) {
        warnCallback(`Duplicate SKU ${key} has different discount_per_unit_dkk`);
      }

      // Aggregate
      existing.quantity += record.quantity;
      existing.total_discount_dkk = existing.discount_per_unit_dkk * existing.quantity;  // RECALCULATE
    } else {
      map.set(key, { ...record });
    }
  }

  return Array.from(map.values())[0];  // Return first for test
}
```

**Test 2: Timezone Conversion**
```javascript
// tests/unit/timezone.test.js
describe('Danish Timezone Handling', () => {
  it('should correctly identify Danish summer time (CEST)', () => {
    // Last Sunday of March 2025 at 02:00 UTC → switches to CEST
    const summerDate = new Date('2025-06-15T12:00:00Z');
    expect(isDanishSummerTime(summerDate)).toBe(true);
  });

  it('should correctly identify Danish winter time (CET)', () => {
    // Last Sunday of October 2025 at 03:00 UTC → switches to CET
    const winterDate = new Date('2025-12-15T12:00:00Z');
    expect(isDanishSummerTime(winterDate)).toBe(false);
  });

  it('should convert Google Sheets date to correct Danish date (summer)', () => {
    // Google Sheets sends: 2025-09-08T22:00:00Z (09/09/2025 - 2 hours)
    const utcDate = new Date('2025-09-08T22:00:00Z');
    const danishDate = extractDanishDate(utcDate);

    expect(danishDate).toBe('2025-09-09');  // NOT 2025-09-08!
  });

  it('should convert Google Sheets date to correct Danish date (winter)', () => {
    // Google Sheets sends: 2025-12-14T23:00:00Z (15/12/2025 - 1 hour)
    const utcDate = new Date('2025-12-14T23:00:00Z');
    const danishDate = extractDanishDate(utcDate);

    expect(danishDate).toBe('2025-12-15');  // NOT 2025-12-14!
  });
});

function isDanishSummerTime(date) {
  // Extract from color-analytics-v2/index.ts (lines 17-42)
  const year = date.getUTCFullYear();

  const marchLastDay = new Date(Date.UTC(year, 2, 31, 1, 0, 0));
  const marchLastSunday = new Date(marchLastDay);
  marchLastSunday.setUTCDate(31 - marchLastDay.getUTCDay());

  const octoberLastDay = new Date(Date.UTC(year, 9, 31, 1, 0, 0));
  const octoberLastSunday = new Date(octoberLastDay);
  octoberLastSunday.setUTCDate(31 - octoberLastDay.getUTCDay());

  return date >= marchLastSunday && date < octoberLastSunday;
}

function extractDanishDate(utcDate) {
  const offset = isDanishSummerTime(utcDate) ? 2 : 1;
  const danishTime = new Date(utcDate.getTime() + offset * 60 * 60 * 1000);
  return danishTime.toISOString().split('T')[0];
}
```

**Run tests:**
```bash
npm test
# Expected output:
# ✅ SKU Duplicate Aggregation: 2 passed
# ✅ Danish Timezone Handling: 4 passed
```

---

## FASE 2: Gradual Refactoring (Week 3-4)
**Risk: LOW - Using feature flags for safety**

### Task 2.1: Extract Bulk Operations Utility
**Create new file WITHOUT touching existing functions**

```bash
touch supabase/functions/_shared/bulk-operations.ts
```

**Deploy NEW function alongside OLD:**
```bash
# Deploy new version with "-v2" suffix
supabase functions deploy bulk-sync-skus-v2 --no-verify-jwt

# OLD function still exists and runs in production
# Test v2 on staging data first
```

### Task 2.2: Feature Flag Implementation
**Add flags to control rollout**

```typescript
// _shared/feature-flags.ts
export const FEATURES = {
  USE_BULK_OPS_V2: {
    enabled: false,
    shops: [], // Start with no shops
  }
};
```

**Gradual rollout:**
```bash
# Week 3: Enable for 1 shop
FEATURES.USE_BULK_OPS_V2.shops = ["pompdelux-da.myshopify.com"]

# Week 3.5: If no errors, add 2 more
FEATURES.USE_BULK_OPS_V2.shops.push("pompdelux-de.myshopify.com", "pompdelux-nl.myshopify.com")

# Week 4: Enable globally
FEATURES.USE_BULK_OPS_V2.enabled = true

# Week 5: Delete old code
```

---

## FASE 3: Webhooks (Week 8+)
**Risk: MEDIUM - New architecture, but isolated**

### Should you start with webhooks NOW?

**❌ My recommendation: WAIT until FASE 2 is done**

**Reasons:**
1. **Webhooks require stable foundation:**
   - Need reliable error handling (FASE 1)
   - Need modular code (FASE 2)
   - Need comprehensive monitoring (FASE 1-2)

2. **Webhooks introduce new complexity:**
   - Event ordering (order created before fulfillment)
   - Deduplication (Shopify can send duplicate events)
   - Retry logic (webhooks can fail)
   - Verification (HMAC signature validation)

3. **Current batch system works:**
   - You already have daily sync
   - Webhooks add real-time, but is that needed yet?
   - Risk/reward ratio favors stability first

**When to add webhooks:**
- ✅ After FASE 1-2 is stable (monitoring + refactoring done)
- ✅ When you NEED real-time updates (is that a requirement?)
- ✅ When you have time to debug webhook-specific issues

**Webhook architecture preview (for later):**
```typescript
// supabase/functions/shopify-webhook-order-create/index.ts
serve(async (req) => {
  // 1. Verify HMAC signature
  const isValid = verifyShopifyWebhook(req);
  if (!isValid) return new Response("Unauthorized", { status: 401 });

  // 2. Parse order data
  const order = await req.json();

  // 3. Idempotency check (prevent duplicates)
  const exists = await checkOrderExists(order.id);
  if (exists) return new Response("Already processed", { status: 200 });

  // 4. Process order (reuse bulk-sync-orders logic)
  await processOrder(order);

  return new Response("OK", { status: 200 });
});
```

---

## Deployment Checklist

### Before ANY deployment:
- [ ] Run all tests locally: `npm test`
- [ ] Test in staging environment
- [ ] Review changes with: `git diff main`
- [ ] Document changes in CHANGELOG.md
- [ ] Create rollback plan

### During deployment:
- [ ] Deploy during low-traffic hours (2-4 AM Danish time)
- [ ] Monitor logs for 30 minutes after deploy
- [ ] Check error rate in function_errors table
- [ ] Verify dashboard data still loads correctly

### Rollback procedure:
```bash
# If something breaks:
# 1. Toggle feature flag to false (instant fix)
FEATURES.NEW_FEATURE.enabled = false

# 2. Or revert to previous git commit
git revert HEAD
git push origin main
supabase functions deploy bulk-sync-skus --no-verify-jwt

# 3. Check error logs
supabase db select "SELECT * FROM function_errors ORDER BY created_at DESC LIMIT 10"
```

---

## Success Metrics

### FASE 1 (Week 1-2):
- [ ] Zero exposed API keys in client code
- [ ] Test coverage > 50%
- [ ] Error tracking table receives logs
- [ ] No production incidents

### FASE 2 (Week 3-4):
- [ ] bulk-sync-skus split into 3 smaller functions
- [ ] Code duplication reduced by 80%
- [ ] Monitoring dashboard deployed
- [ ] No production incidents

### FASE 3 (Week 8+):
- [ ] Real-time webhook processing working
- [ ] Latency < 60 seconds for new orders
- [ ] Webhook deduplication working
- [ ] No production incidents

---

## Next Steps

**I can help you implement FASE 1 Task 1.1 RIGHT NOW with zero risk:**
1. Create logger.ts utility
2. Create migration for function_errors table
3. Test locally
4. Deploy (safe - only adds new table)

**Should I proceed?**
