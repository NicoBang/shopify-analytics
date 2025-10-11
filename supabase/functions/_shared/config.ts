// Shared configuration for all Supabase Edge Functions
export const SHOPIFY_CONFIG = {
  API_VERSION: "2025-01",
  SHOPS: {
    DA: "pompdelux-da.myshopify.com",
    DE: "pompdelux-de.myshopify.com",
    NL: "pompdelux-nl.myshopify.com",
    INT: "pompdelux-int.myshopify.com",
    CHF: "pompdelux-chf.myshopify.com"
  },
  CURRENCY_RATES: {
    DKK: 1.0,
    EUR: 7.46,
    CHF: 6.84
  },
  TAX_RATES: {
    DKK: 0.25,
    EUR: 0.19,
    CHF: 0.077
  },
  BATCH_SIZE: 500,
  TIMEOUT_MINUTES: 5
} as const;

export type ShopName = keyof typeof SHOPIFY_CONFIG.SHOPS;
export type CurrencyCode = keyof typeof SHOPIFY_CONFIG.CURRENCY_RATES;