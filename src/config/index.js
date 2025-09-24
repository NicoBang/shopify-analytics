// src/config/index.js
require('dotenv').config({ path: '.env.local' });

const CONFIG = {
  // Dine 5 Shopify shops
  SHOPS: [
    {
      domain: 'pompdelux-da.myshopify.com',
      token: process.env.SHOPIFY_TOKEN_DA,
      currency: 'DKK',
      rate: 1.0
    },
    {
      domain: 'pompdelux-de.myshopify.com',
      token: process.env.SHOPIFY_TOKEN_DE,
      currency: 'EUR',
      rate: 7.46
    },
    {
      domain: 'pompdelux-nl.myshopify.com',
      token: process.env.SHOPIFY_TOKEN_NL,
      currency: 'EUR',
      rate: 7.46
    },
    {
      domain: 'pompdelux-int.myshopify.com',
      token: process.env.SHOPIFY_TOKEN_INT,
      currency: 'EUR',
      rate: 7.46
    },
    {
      domain: 'pompdelux-chf.myshopify.com',
      token: process.env.SHOPIFY_TOKEN_CHF,
      currency: 'CHF',
      rate: 6.84
    }
  ],
  
  // Datoer og limits (samme som din Google Apps Script)
  CUTOFF_DATE: new Date('2024-09-30'),
  CHUNK_DAYS: 30,
  MAX_ORDERS_PER_PAGE: 250,
  MAX_LINE_ITEMS: 100,
  RATE_LIMIT_MS: 250,
  API_VERSION: '2024-10'
};

// Export så andre filer kan bruge config
module.exports = { CONFIG };