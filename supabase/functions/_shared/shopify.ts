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