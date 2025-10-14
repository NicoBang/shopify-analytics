// Shopify API utilities
import { SHOPIFY_CONFIG, type ShopName } from "./config.ts";

export function getShopifyToken(shop: string): string {
  const shopKey = Object.keys(SHOPIFY_CONFIG.SHOPS).find(
    key => SHOPIFY_CONFIG.SHOPS[key as ShopName] === shop
  ) as ShopName;

  if (!shopKey) {
    throw new Error(`Unknown shop: ${shop}`);
  }

  const tokenEnvName = `SHOPIFY_TOKEN_${shopKey}`;
  const token = Deno.env.get(tokenEnvName);

  if (!token) {
    throw new Error(`Missing environment variable: ${tokenEnvName}`);
  }

  return token;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1} failed:`, error);

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

export function getCurrencyMultiplier(shop: string): number {
  if (shop.includes("-da")) return SHOPIFY_CONFIG.CURRENCY_RATES.DKK;
  if (shop.includes("-de") || shop.includes("-nl") || shop.includes("-int")) {
    return SHOPIFY_CONFIG.CURRENCY_RATES.EUR;
  }
  if (shop.includes("-chf")) return SHOPIFY_CONFIG.CURRENCY_RATES.CHF;
  return 1.0;
}

export function getTaxRate(shop: string): number {
  if (shop.includes("-da")) return SHOPIFY_CONFIG.TAX_RATES.DKK;
  if (shop.includes("-de") || shop.includes("-nl") || shop.includes("-int")) {
    return SHOPIFY_CONFIG.TAX_RATES.EUR;
  }
  if (shop.includes("-chf")) return SHOPIFY_CONFIG.TAX_RATES.CHF;
  return 0;
}

/**
 * Adjust local date to UTC for querying
 * Converts Danish local date (YYYY-MM-DD) to UTC timestamp accounting for timezone offset
 *
 * Example: 2024-10-01 (Danish date) → 2024-09-30T22:00:00Z (UTC, accounting for CEST +0200)
 *
 * This fixes the timezone discrepancy where orders created 00:00-02:00 Danish time
 * fall into the previous day in UTC.
 *
 * @param localDate - Date string in YYYY-MM-DD format (Danish local date)
 * @param endOfDay - If true, returns 22:00:00Z (next day start), else 22:00:00Z (day start)
 * @returns ISO 8601 timestamp in UTC adjusted for Danish timezone
 */
export function adjustLocalDateToUTC(localDate: string, endOfDay = false): string {
  try {
    // Parse the local date (YYYY-MM-DD)
    const [year, month, day] = localDate.split('-').map(Number);

    // Create date object representing midnight Danish time
    const danishMidnight = new Date(year, month - 1, day, 0, 0, 0);

    // Determine timezone offset for this date (CEST or CET)
    // We use Intl to check what the offset is on this specific date
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Copenhagen',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(danishMidnight);
    const localYear = parts.find(p => p.type === 'year')?.value;
    const localMonth = parts.find(p => p.type === 'month')?.value;
    const localDay = parts.find(p => p.type === 'day')?.value;
    const localHour = parts.find(p => p.type === 'hour')?.value;

    // Reconstruct as local time
    const localTime = new Date(`${localYear}-${localMonth}-${localDay}T${localHour}:00:00`);

    // Calculate offset in hours
    const offsetMs = danishMidnight.getTime() - localTime.getTime();
    const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));

    // Adjust for offset: Danish midnight - offset = UTC time
    // Example: Oct 1 00:00 CEST (+2) = Sep 30 22:00 UTC
    const utcDate = new Date(year, month - 1, day, -offsetHours, 0, 0);

    if (endOfDay) {
      // Add 24 hours to get the start of next day
      utcDate.setDate(utcDate.getDate() + 1);
    }

    return utcDate.toISOString().replace('.000Z', 'Z');
  } catch (error) {
    console.error('Error adjusting local date to UTC:', error);
    // Fallback: assume CEST (+2) offset
    const fallbackDate = new Date(`${localDate}T00:00:00`);
    fallbackDate.setHours(fallbackDate.getHours() - 2);
    if (endOfDay) {
      fallbackDate.setDate(fallbackDate.getDate() + 1);
    }
    return fallbackDate.toISOString().replace('.000Z', 'Z');
  }
}