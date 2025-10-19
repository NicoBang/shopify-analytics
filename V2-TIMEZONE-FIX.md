# V2 Timezone Date Extraction Fix

## Problem
When selecting 16/10/2024 to 16/10/2024 in Google Sheets Dashboard_2_0, the system was querying `daily_shop_metrics` for both 2024-10-16 AND 2024-10-17, returning 83 orders instead of the expected 32 orders for DA shop.

## Root Causes

### Issue 1: Flawed DST Detection in Google Sheets `formatDateWithTime()`
**Location:** `google-sheets-enhanced.js` line 1368 (original)

The original logic used `getTimezoneOffset()` to detect DST:
```javascript
const isDST = testDate.getTimezoneOffset() === -120; // WRONG!
```

This is problematic because `getTimezoneOffset()` returns the offset based on where the Google Apps Script runtime is located, not necessarily Danish timezone. This caused incorrect UTC timestamp generation.

### Issue 2: Flawed DST Detection in `getDashboardFromAggregatedMetrics()`
**Location:** `api/analytics-v2.js` lines 38-45 (original)

The original logic detected DST based on the UTC hour of the timestamp:
- If hour = 22 → assumed summer time (UTC+2)
- Otherwise → assumed winter time (UTC+1)

This failed for end-of-day timestamps:
- Start: `2024-10-15T22:00:00Z` (hour=22) → offset=2 → `2024-10-16` ✅
- End: `2024-10-16T21:59:59Z` (hour=21) → offset=1 → `2024-10-17` ❌

### Issue 3: Double Timezone Conversion in Handler
**Location:** `api/analytics-v2.js` lines 751-752 (original)

The handler was calling `adjustLocalDateToUTC()` on dates that were already UTC timestamps from Google Sheets:

```javascript
const start = adjustLocalDateToUTC(startDate, false); // WRONG for ISO timestamps!
const end = adjustLocalDateToUTC(endDate, true);
```

`adjustLocalDateToUTC()` is designed to convert **local Danish date strings** (e.g., "2024-10-16") to UTC, not to process ISO timestamps that are already in UTC format (e.g., "2024-10-15T22:00:00Z").

This caused double-conversion:
1. Google Sheets: 16/10/2024 → `2024-10-15T22:00:00Z` (correct UTC for Danish date)
2. Handler: Parses timestamp, extracts date parts, applies timezone conversion AGAIN
3. Result: Wrong dates passed to `getDashboardFromAggregatedMetrics()`

## Solutions

### Fix 1: Proper DST Calculation in Google Sheets
**Location:** `google-sheets-enhanced.js` lines 1357-1394

Added calendar-based DST helper functions that work regardless of where the script runs:

```javascript
function isDanishDST_(year, month, day) {
  // Before March or after October: definitely winter time
  if (month < 3 || month > 10) return false;
  
  // April to September: definitely summer time
  if (month > 3 && month < 10) return true;
  
  // March: check if we're past the last Sunday
  if (month === 3) {
    const lastSunday = getLastSundayOfMonth_(year, 3);
    return day >= lastSunday;
  }
  
  // October: check if we're before the last Sunday
  if (month === 10) {
    const lastSunday = getLastSundayOfMonth_(year, 10);
    return day < lastSunday;
  }
  
  return false;
}
```

Updated `formatDateWithTime()` to use this function:
```javascript
const isDST = isDanishDST_(year, Number(month), Number(day));
const utcOffset = isDST ? 2 : 1;
```

### Fix 2: Proper DST Calculation in API
**Location:** `api/analytics-v2.js` lines 38-54

Implemented `isDanishSummerTime()` function that calculates DST based on EU rules:
- CEST (UTC+2): Last Sunday of March 02:00 to Last Sunday of October 03:00
- CET (UTC+1): Rest of year

```javascript
function isDanishSummerTime(utcTimestamp) {
  const date = new Date(utcTimestamp);
  const year = date.getUTCFullYear();
  
  // Find last Sunday of March
  const marchLastDay = new Date(Date.UTC(year, 2, 31, 1, 0, 0));
  const marchLastSunday = new Date(marchLastDay);
  marchLastSunday.setUTCDate(31 - marchLastDay.getUTCDay());
  
  // Find last Sunday of October
  const octoberLastDay = new Date(Date.UTC(year, 9, 31, 1, 0, 0));
  const octoberLastSunday = new Date(octoberLastDay);
  octoberLastSunday.setUTCDate(31 - octoberLastDay.getUTCDay());
  
  return date >= marchLastSunday && date < octoberLastSunday;
}

// Apply correct offset
const startOffset = isDanishSummerTime(startDate) ? 2 : 1;
const endOffset = isDanishSummerTime(endDate) ? 2 : 1;
```

### Fix 3: Skip Double Conversion for ISO Timestamps
**Location:** `api/analytics-v2.js` lines 748-767

Added detection for ISO timestamps and parse them directly without timezone conversion:

```javascript
// Check if dates are already ISO timestamps (contain 'T')
const startIsISO = typeof startDate === 'string' && startDate.includes('T');
const endIsISO = typeof endDate === 'string' && endDate.includes('T');

if (startIsISO && endIsISO) {
  // Google Sheets format: Already UTC timestamps, parse directly
  start = new Date(startDate);
  end = new Date(endDate);
} else {
  // Simple date strings: Convert Danish local dates to UTC
  start = adjustLocalDateToUTC(startDate, false);
  end = adjustLocalDateToUTC(endDate, true);
}
```

## Verification

After the fix, when selecting 16/10/2024 to 16/10/2024:

1. **Google Sheets sends:**
   - Start: `2024-10-15T22:00:00Z`
   - End: `2024-10-16T21:59:59Z`

2. **Handler parses directly:**
   - Start: `Date(2024-10-15T22:00:00Z)`
   - End: `Date(2024-10-16T21:59:59Z)`

3. **getDashboardFromAggregatedMetrics() extracts dates:**
   - Start: DST check → October is in CEST → offset=2 → `2024-10-16`
   - End: DST check → October is in CEST → offset=2 → `2024-10-16`

4. **SQL Query:**
   ```sql
   WHERE metric_date >= '2024-10-16' 
     AND metric_date <= '2024-10-16'
   ```

5. **Result:** Returns only data for 2024-10-16 ✅

## Testing Checklist

- [x] Select 16/10/2024 to 16/10/2024 (summer time) → Should query only `metric_date = '2024-10-16'`
- [ ] Select 16/01/2025 to 16/01/2025 (winter time) → Should query only `metric_date = '2025-01-16'`
- [ ] Select date range across DST boundary (e.g., 20/03/2024 to 10/04/2024) → Should correctly handle both CET and CEST dates
- [ ] Verify order counts match direct SQL queries against `daily_shop_metrics`

## Debug Logs

Added comprehensive logging to help diagnose any future issues:

```javascript
console.log(`🔍 DEBUG: Incoming UTC timestamps:`);
console.log(`   Start: ${startDate.toISOString()} (DST=${isDanishSummerTime(startDate)}, offset=${startOffset}h)`);
console.log(`   End: ${endDate.toISOString()} (DST=${isDanishSummerTime(endDate)}, offset=${endOffset}h)`);
console.log(`⚡ Fetching pre-aggregated metrics: ${dateStart} to ${dateEnd}`);
```

Check Vercel logs to see these debug messages and verify correct date extraction.

