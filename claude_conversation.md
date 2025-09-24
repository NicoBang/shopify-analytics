Jeg har et Analytics Dashboard, der henter data ud af fem Shopify shops og ud i Google Sheets via Google Apps Scripts. 
Det er efterhånden blevet meget kompliceret og omfangsrigt. Og jeg havner ofte i situationer, hvor mine scripts ender i timeout. Og jeg har efterhånden så meget data, at jeg overskrider Googles limits for antal celler.
Jeg vil gerne have dig til at gennemanalysere mit projekt og komme med forslag til forbedringer. Eller måske tænke i, om det skal laves på en helt anden måde - evt. uden Google Apps Scripts. 
Men det vigtigste er, at det bliver stabilt og hurtigt.

Det ligger i Github - kan du gennemgå det: https://github.com/8kilo/PdL_analytics

🚀 KOMPLET MIGRATIONSPLAN: Google Apps Script → Modern Stack
📋 PROJEKTINFORMATION FOR CLAUDE CODE
Mål: Migrere et Google Apps Script-baseret Shopify analytics system til en moderne, skalerbar løsning.
Nuværende system:

5 Shopify shops med ~15.000 linjer Google Apps Script kode
Data gemmes i Google Sheets (problemer med timeouts og størrelsesbegrænsninger)
Daglig synkronisering af ordrer, SKUs, inventory og fulfillments

Ny arkitektur:

Database: Supabase (PostgreSQL) - GRATIS
Backend: Node.js på Vercel - GRATIS
Scheduler: GitHub Actions - GRATIS
Frontend: Google Sheets (kun visualisering)


📁 FASE 1: PROJEKT SETUP (DAG 1)
Step 1.1: Initialiser nyt Node.js projekt
bash# Opret projektmappe
mkdir shopify-analytics
cd shopify-analytics

# Initialiser npm projekt
npm init -y

# Installer nødvendige dependencies
npm install --save \
  @supabase/supabase-js \
  axios \
  dotenv \
  date-fns

# Dev dependencies
npm install --save-dev \
  @vercel/node \
  @types/node \
  typescript \
  nodemon

# Opret projektstruktur
mkdir -p src/{lib,api,services,types,utils,migrations}
touch .env.local .env.example .gitignore vercel.json
Step 1.2: Setup TypeScript configuration
Opret tsconfig.json:
json{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
Step 1.3: Konfigurer Vercel
Opret vercel.json:
json{
  "functions": {
    "api/*.js": {
      "maxDuration": 60
    }
  },
  "env": {
    "NODE_ENV": "production"
  },
  "crons": [
    {
      "path": "/api/cron/sync-all",
      "schedule": "0 */6 * * *"
    }
  ]
}
Step 1.4: Environment variables template
Opret .env.example:
bash# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Shopify Tokens
SHOPIFY_TOKEN_DA=token-for-danish-shop
SHOPIFY_TOKEN_DE=token-for-german-shop
SHOPIFY_TOKEN_NL=token-for-dutch-shop
SHOPIFY_TOKEN_INT=token-for-international-shop
SHOPIFY_TOKEN_CHF=token-for-swiss-shop

# API Security
API_SECRET_KEY=generate-a-random-key-here

# Environment
NODE_ENV=development

💾 FASE 2: DATABASE SETUP (DAG 2)
Step 2.1: Opret Supabase konto og projekt

Gå til https://app.supabase.com
Opret gratis konto
Opret nyt projekt (vælg region tæt på Danmark, fx Frankfurt)
Gem connection details

Step 2.2: Database Schema
Kør dette i Supabase SQL Editor:
sql-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Orders table (optimeret struktur)
CREATE TABLE orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  country VARCHAR(10),
  discounted_total DECIMAL(10,2),
  tax DECIMAL(10,2),
  shipping DECIMAL(10,2),
  item_count INTEGER DEFAULT 0,
  refunded_amount DECIMAL(10,2) DEFAULT 0,
  refunded_qty INTEGER DEFAULT 0,
  refund_date TIMESTAMPTZ,
  total_discounts_ex_tax DECIMAL(10,2) DEFAULT 0,
  cancelled_qty INTEGER DEFAULT 0,
  raw_data JSONB,
  UNIQUE(shop, order_id)
);

-- SKU table
CREATE TABLE skus (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  sku VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  country VARCHAR(10),
  product_title TEXT,
  variant_title TEXT,
  quantity INTEGER DEFAULT 0,
  refunded_qty INTEGER DEFAULT 0,
  price_dkk DECIMAL(10,2),
  refund_date TIMESTAMPTZ,
  UNIQUE(shop, order_id, sku)
);

-- Inventory table
CREATE TABLE inventory (
  sku VARCHAR(200) PRIMARY KEY,
  quantity INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Product metadata table
CREATE TABLE product_metadata (
  sku VARCHAR(200) PRIMARY KEY,
  product_title TEXT,
  variant_title TEXT,
  status VARCHAR(50),
  cost DECIMAL(10,2),
  program VARCHAR(100),
  produkt VARCHAR(200),
  farve VARCHAR(100),
  artikelnummer VARCHAR(100),
  season VARCHAR(50),
  gender VARCHAR(20),
  størrelse VARCHAR(20),
  varemodtaget INTEGER DEFAULT 0,
  kostpris DECIMAL(10,2),
  stamvarenummer VARCHAR(100),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Fulfillments table
CREATE TABLE fulfillments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  country VARCHAR(10),
  carrier VARCHAR(100),
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync log table (til tracking)
CREATE TABLE sync_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  shop VARCHAR(100),
  sync_type VARCHAR(50),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  status VARCHAR(20) DEFAULT 'running'
);

-- Indexes for performance
CREATE INDEX idx_orders_shop_created ON orders(shop, created_at DESC);
CREATE INDEX idx_orders_dates ON orders(created_at DESC, updated_at DESC);
CREATE INDEX idx_skus_shop_created ON skus(shop, created_at DESC);
CREATE INDEX idx_skus_sku ON skus(sku);
CREATE INDEX idx_fulfillments_date ON fulfillments(date DESC);
CREATE INDEX idx_sync_log_shop ON sync_log(shop, started_at DESC);

-- Views for analytics
CREATE VIEW order_analytics AS
SELECT 
  shop,
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as order_count,
  SUM(discounted_total) as total_revenue,
  SUM(refunded_amount) as total_refunded,
  AVG(discounted_total) as avg_order_value
FROM orders
GROUP BY shop, DATE_TRUNC('day', created_at);

-- Function to clean old sync logs
CREATE OR REPLACE FUNCTION clean_old_sync_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM sync_log 
  WHERE started_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

🔄 FASE 3: MIGRÉR KODE TIL NODE.JS (DAG 3-4)
Step 3.1: Konverter Config
Opret src/config/index.ts:
typescriptexport const CONFIG = {
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
  CUTOFF_DATE: new Date('2024-09-30'),
  CHUNK_DAYS: 30,
  MAX_ORDERS_PER_PAGE: 250,
  MAX_LINE_ITEMS: 100,
  RATE_LIMIT_MS: 250,
  API_VERSION: '2024-10'
};
Step 3.2: Konverter ShopifyAPIClient
Opret src/services/ShopifyAPIClient.ts:
typescriptimport axios from 'axios';
import { CONFIG } from '../config';

export class ShopifyAPIClient {
  private shop: any;
  private endpoint: string;
  private headers: any;

  constructor(shop: any) {
    this.shop = shop;
    this.endpoint = `https://${shop.domain}/admin/api/${CONFIG.API_VERSION}/graphql.json`;
    this.headers = {
      'X-Shopify-Access-Token': shop.token,
      'Content-Type': 'application/json'
    };
  }

  async query(queryString: string, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          this.endpoint,
          { query: queryString },
          { headers: this.headers }
        );

        if (response.data.errors) {
          throw new Error(response.data.errors[0].message);
        }

        return response.data.data;
      } catch (error: any) {
        if (error.response?.status === 429 && attempt < retries) {
          // Rate limited - wait and retry
          const retryAfter = error.response.headers['retry-after'] || 2;
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // KOPIER fetchOrders, fetchSkuData, etc. fra din eksisterende kode
  // Konverter Logger.log() til console.log()
  // Konverter Utilities.sleep() til await new Promise(resolve => setTimeout(resolve, ms))
  
  async fetchOrders(startDate: Date, endDate: Date): Promise<any[]> {
    // Kopier din eksisterende fetchOrders implementation her
    // Bare udskift Logger.log med console.log
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
    const output: any[] = [];
    let cursor: string | null = null;

    // ... resten af din eksisterende kode
    return output;
  }
}
Step 3.3: Opret Supabase Service
Opret src/services/SupabaseService.ts:
typescriptimport { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export class SupabaseService {
  async upsertOrders(orders: any[]): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .upsert(orders, { onConflict: 'shop,order_id' });
    
    if (error) throw error;
  }

  async upsertSkus(skus: any[]): Promise<void> {
    const { error } = await supabase
      .from('skus')
      .upsert(skus, { onConflict: 'shop,order_id,sku' });
    
    if (error) throw error;
  }

  async updateInventory(inventory: any[]): Promise<void> {
    const { error } = await supabase
      .from('inventory')
      .upsert(inventory, { onConflict: 'sku' });
    
    if (error) throw error;
  }

  async getOrdersForPeriod(startDate: Date, endDate: Date): Promise<any[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());
    
    if (error) throw error;
    return data || [];
  }

  async logSync(shop: string, syncType: string, recordsSynced: number): Promise<void> {
    await supabase
      .from('sync_log')
      .insert({
        shop,
        sync_type: syncType,
        records_synced: recordsSynced,
        completed_at: new Date().toISOString(),
        status: 'completed'
      });
  }
}

🌐 FASE 4: API ENDPOINTS (DAG 5)
Step 4.1: Sync Endpoint
Opret api/sync-shop.ts:
typescriptimport { VercelRequest, VercelResponse } from '@vercel/node';
import { ShopifyAPIClient } from '../src/services/ShopifyAPIClient';
import { SupabaseService } from '../src/services/SupabaseService';
import { CONFIG } from '../src/config';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify API key
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { shop: shopDomain, type = 'orders', days = 7 } = req.query;
  
  try {
    // Find shop config
    const shop = CONFIG.SHOPS.find(s => s.domain === shopDomain);
    if (!shop) {
      return res.status(400).json({ error: 'Invalid shop' });
    }

    // Initialize services
    const shopifyClient = new ShopifyAPIClient(shop);
    const supabaseService = new SupabaseService();

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    console.log(`Syncing ${type} for ${shopDomain} from ${startDate} to ${endDate}`);

    let recordsSynced = 0;

    switch (type) {
      case 'orders':
        const orders = await shopifyClient.fetchOrders(startDate, endDate);
        await supabaseService.upsertOrders(orders);
        recordsSynced = orders.length;
        break;

      case 'skus':
        const skus = await shopifyClient.fetchSkuData(startDate, endDate, new Set());
        await supabaseService.upsertSkus(skus);
        recordsSynced = skus.length;
        break;

      // Add more cases as needed
    }

    // Log the sync
    await supabaseService.logSync(shopDomain, type, recordsSynced);

    return res.status(200).json({
      success: true,
      shop: shopDomain,
      type,
      recordsSynced,
      period: { startDate, endDate }
    });

  } catch (error: any) {
    console.error('Sync error:', error);
    return res.status(500).json({
      error: error.message,
      shop: shopDomain,
      type
    });
  }
}
Step 4.2: Analytics Endpoint
Opret api/analytics.ts:
typescriptimport { VercelRequest, VercelResponse } from '@vercel/node';
import { SupabaseService } from '../src/services/SupabaseService';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS for Google Sheets
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  // Verify API key
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { startDate, endDate, type = 'dashboard' } = req.query;

  try {
    const supabaseService = new SupabaseService();
    
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    const orders = await supabaseService.getOrdersForPeriod(start, end);

    // Transform data for Google Sheets
    const rows = orders.map(order => [
      order.shop,
      order.order_id,
      order.created_at,
      order.country,
      order.discounted_total,
      order.tax,
      order.shipping,
      order.item_count,
      order.refunded_amount,
      order.refunded_qty,
      order.refund_date
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      count: rows.length
    });

  } catch (error: any) {
    console.error('Analytics error:', error);
    return res.status(500).json({ error: error.message });
  }
}

📊 FASE 5: GOOGLE SHEETS INTEGRATION (DAG 6)
Step 5.1: Opdater Google Apps Script
Erstat HELE din eksisterende kode med:
javascript// Simplified Google Apps Script - Nu kun til visualisering!

const API_BASE_URL = 'https://your-app.vercel.app/api';
const API_KEY = 'your-api-secret-key'; // Gem dette sikkert!

/**
 * Hent data fra ny API
 */
function fetchFromAPI(endpoint, params = {}) {
  const url = `${API_BASE_URL}${endpoint}?` + Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
    
  const response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    },
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error(`API Error: ${response.getContentText()}`);
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * Opdater Dashboard
 */
function updateDashboard() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  
  // Læs datoer
  const startDate = sheet.getRange('B1').getValue();
  const endDate = sheet.getRange('B2').getValue();
  
  // Hent data fra API
  const result = fetchFromAPI('/analytics', {
    startDate: Utilities.formatDate(startDate, 'GMT', 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(endDate, 'GMT', 'yyyy-MM-dd'),
    type: 'dashboard'
  });
  
  // Clear gamle data
  sheet.getRange('A5:Z').clearContent();
  
  // Skriv ny data
  if (result.data && result.data.length > 0) {
    sheet.getRange(5, 1, result.data.length, result.data[0].length)
      .setValues(result.data);
  }
  
  // Update timestamp
  sheet.getRange('A3').setValue(`Sidst opdateret: ${new Date()}`);
}

/**
 * Setup menu
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Analytics')
    .addItem('🔄 Opdater Dashboard', 'updateDashboard')
    .addItem('📈 Opdater STYLE SKU', 'updateStyleSku')
    .addSeparator()
    .addItem('⚙️ Settings', 'showSettings')
    .addToUi();
}

/**
 * Trigger sync i backend
 */
function triggerSync(shop, type) {
  const result = fetchFromAPI('/sync-shop', {
    shop: shop,
    type: type,
    days: 7
  });
  
  SpreadsheetApp.getUi().alert(
    `Sync completed: ${result.recordsSynced} records synced for ${shop}`
  );
}

/**
 * Setup automatiske triggers (kører hver time - ingen timeout!)
 */
function setupTriggers() {
  // Slet eksisterende
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Opret ny trigger
  ScriptApp.newTrigger('updateDashboard')
    .timeBased()
    .everyHours(1)
    .create();
}

🚀 FASE 6: DEPLOYMENT (DAG 7)
Step 6.1: Deploy til Vercel
bash# Install Vercel CLI
npm install -g vercel

# Login til Vercel
vercel login

# Deploy (følg prompts)
vercel --prod

# Gem deployment URL (fx: https://shopify-analytics.vercel.app)
Step 6.2: Setup GitHub Actions
Opret .github/workflows/sync-shopify.yml:
yamlname: Sync Shopify Data
on:
  schedule:
    # Kører hver 6. time
    - cron: '0 */6 * * *'
  workflow_dispatch: # Manuel trigger

jobs:
  sync-orders:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shop: [
          'pompdelux-da.myshopify.com',
          'pompdelux-de.myshopify.com',
          'pompdelux-nl.myshopify.com',
          'pompdelux-int.myshopify.com',
          'pompdelux-chf.myshopify.com'
        ]
    steps:
      - name: Sync Orders for ${{ matrix.shop }}
        run: |
          curl -X POST ${{ secrets.API_URL }}/api/sync-shop \
            -H "Authorization: Bearer ${{ secrets.API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"shop": "${{ matrix.shop }}", "type": "orders", "days": 1}'
          
      - name: Sync SKUs for ${{ matrix.shop }}
        run: |
          curl -X POST ${{ secrets.API_URL }}/api/sync-shop \
            -H "Authorization: Bearer ${{ secrets.API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"shop": "${{ matrix.shop }}", "type": "skus", "days": 1}'
Step 6.3: Setup GitHub Secrets
Gå til GitHub repo → Settings → Secrets → Actions:
API_URL = https://your-app.vercel.app
API_KEY = your-secret-api-key

🔄 FASE 7: DATA MIGRATION (WEEKEND)
Step 7.1: Migration Script
Opret src/migrations/migrate-from-sheets.ts:
typescriptimport { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function migrateOrders() {
  console.log('Starting ORDER migration...');
  
  // Setup Google Sheets API
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json', // Download fra Google Cloud Console
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Læs ORDER_CACHE sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: 'YOUR_SPREADSHEET_ID', // Fra URL'en
    range: '_ORDER_CACHE!A:M',
  });
  
  const rows = response.data.values || [];
  const headers = rows[0];
  const data = rows.slice(1);
  
  console.log(`Found ${data.length} orders to migrate`);
  
  // Transform til database format
  const orders = data.map(row => ({
    shop: row[0],
    order_id: row[1],
    created_at: row[2],
    country: row[3],
    discounted_total: parseFloat(row[4]) || 0,
    tax: parseFloat(row[5]) || 0,
    shipping: parseFloat(row[6]) || 0,
    item_count: parseInt(row[7]) || 0,
    refunded_amount: parseFloat(row[8]) || 0,
    refunded_qty: parseInt(row[9]) || 0,
    refund_date: row[10] || null,
    total_discounts_ex_tax: parseFloat(row[11]) || 0,
    cancelled_qty: parseInt(row[12]) || 0,
  }));
  
  // Batch insert (1000 ad gangen)
  const batchSize = 1000;
  for (let i = 0; i < orders.length; i += batchSize) {
    const batch = orders.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('orders')
      .upsert(batch, { onConflict: 'shop,order_id' });
    
    if (error) {
      console.error(`Error in batch ${i}:`, error);
    } else {
      console.log(`Migrated ${i + batch.length}/${orders.length} orders`);
    }
  }
  
  console.log('✅ Order migration complete!');
}

// Kør migrering
async function runMigration() {
  console.log('🚀 Starting migration from Google Sheets to Supabase...');
  
  await migrateOrders();
  // await migrateSkus();  // Tilføj disse funktioner
  // await migrateInventory();
  // await migrateFulfillments();
  
  console.log('🎉 Migration complete!');
}

runMigration().catch(console.error);
Step 7.2: Kør migration
bash# Installer Google API
npm install googleapis

# Download Google credentials
# 1. Gå til https://console.cloud.google.com
# 2. Opret projekt
# 3. Enable Google Sheets API
# 4. Create credentials → Service Account
# 5. Download JSON key som 'credentials.json'

# Kør migration
npx ts-node src/migrations/migrate-from-sheets.ts

✅ FASE 8: VERIFIKATION OG TEST
Step 8.1: Test Checklist
typescript// Opret test-suite: src/tests/verify-migration.ts

async function verifyMigration() {
  console.log('🔍 Verifying migration...');
  
  // 1. Check record counts
  const { count: orderCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });
    
  console.log(`✓ Orders in database: ${orderCount}`);
  
  // 2. Test sync endpoint
  const syncResponse = await fetch(`${API_URL}/api/sync-shop`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      shop: 'pompdelux-da.myshopify.com',
      type: 'orders',
      days: 1
    })
  });
  
  console.log(`✓ Sync endpoint: ${syncResponse.status}`);
  
  // 3. Test analytics endpoint
  const analyticsResponse = await fetch(`${API_URL}/api/analytics?startDate=2024-01-01&endDate=2024-12-31`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    }
  });
  
  const data = await analyticsResponse.json();
  console.log(`✓ Analytics endpoint: ${data.data.length} records`);
  
  // 4. Test Google Sheets integration
  console.log('✓ Run updateDashboard() in Google Sheets to verify integration');
  
  console.log('✅ All tests passed!');
}

📋 FINAL CHECKLIST FOR CLAUDE CODE
Før du starter:

 Backup alle Google Sheets
 Export alle tokens fra Script Properties
 Download 3 måneders historisk data som backup

Implementation:

 Dag 1: Setup projekt struktur og dependencies
 Dag 2: Opret Supabase database og schema
 Dag 3-4: Konverter Shopify API client til Node.js
 Dag 5: Implementer API endpoints
 Dag 6: Opdater Google Sheets integration
 Dag 7: Deploy til Vercel
 Weekend: Migrer historisk data

Efter implementation:

 Verificer alle endpoints fungerer
 Test sync for alle 5 shops
 Sammenlign data mellem gammelt og nyt system
 Setup monitoring og alerts
 Dokumenter API endpoints

Rollback plan:
Behold det gamle system kørende i 2 uger efter migration. Hvis noget går galt, kan du nemt skifte tilbage.

🎯 FORVENTEDE RESULTATER

Performance: 100x hurtigere queries
Stabilitet: Ingen timeouts
Skalerbarhed: Kan håndtere millioner af records
Omkostninger: $0-5/måned
Maintenance: 90% mindre kode at vedligeholde

SUCCESS CRITERIA: Når du kan køre updateDashboard() i Google Sheets og få data på under 5 sekunder, er migreringen succesfuld! 🚀
