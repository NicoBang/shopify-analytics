# 🚀 Shopify Analytics Deployment Guide

## Overview
This guide will help you deploy your new fast, robust Shopify Analytics system to replace your Google Apps Script setup.

## 📋 Pre-Deployment Checklist

### ✅ 1. Environment Variables Setup
Copy `.env.example` to `.env.local` and fill in your values:

```bash
# Supabase (get from https://app.supabase.com)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Shopify Tokens (from your current Google Apps Script)
SHOPIFY_TOKEN_DA=your-danish-shop-token
SHOPIFY_TOKEN_DE=your-german-shop-token
SHOPIFY_TOKEN_NL=your-dutch-shop-token
SHOPIFY_TOKEN_INT=your-international-shop-token
SHOPIFY_TOKEN_CHF=your-swiss-shop-token

# Generate a random API key for security
API_SECRET_KEY=your-random-32-character-secret-key

# Environment
NODE_ENV=production
```

### ✅ 2. Test Your Setup Locally

```bash
# Install dependencies
npm install

# Test the complete system
node src/test-complete.js

# Test individual components
node src/test-fetch-orders.js
node src/test-config.js
```

## 🗄️ Database Setup (Supabase)

### Step 1: Create Supabase Project
1. Go to [app.supabase.com](https://app.supabase.com)
2. Create a new project
3. Choose a region close to Denmark (e.g., Frankfurt)
4. Save your project URL and API keys

### Step 2: Run Database Schema
1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `src/migrations/supabase-schema.sql`
4. Click "Run" to create all tables and indexes

### Step 3: Verify Setup
```sql
-- Test query to verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public';
```

## 🌐 Vercel Deployment

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Login to Vercel
```bash
vercel login
```

### Step 3: Deploy
```bash
# Deploy to production
vercel --prod

# Follow the prompts:
# - Link to existing project? No
# - Project name: shopify-analytics
# - Deploy? Yes
```

### Step 4: Configure Environment Variables in Vercel
After deployment, add your environment variables:

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add API_SECRET_KEY
vercel env add SHOPIFY_TOKEN_DA
vercel env add SHOPIFY_TOKEN_DE
vercel env add SHOPIFY_TOKEN_NL
vercel env add SHOPIFY_TOKEN_INT
vercel env add SHOPIFY_TOKEN_CHF
```

Or use the Vercel dashboard:
1. Go to your project settings
2. Navigate to Environment Variables
3. Add all variables from your `.env.local`

### Step 5: Test Deployment
```bash
# Test your deployed API (replace with your actual URL)
curl -H "Authorization: Bearer YOUR_API_KEY" \
     "https://your-project.vercel.app/api/analytics?startDate=2024-01-01&endDate=2024-01-01"
```

## 📊 Google Sheets Integration

### Step 1: Update Google Apps Script
1. Open your existing Google Sheets
2. Go to Extensions → Apps Script
3. Replace ALL existing code with the contents of `google-sheets-script.js`
4. Update these variables at the top:
   ```javascript
   const API_BASE_URL = 'https://your-actual-vercel-url.vercel.app/api';
   const API_KEY = 'your-actual-api-secret-key';
   ```

### Step 2: Test Google Sheets Integration
1. In Google Sheets, run `testApiConnection()` from the script editor
2. Should show "✅ API Connection Successful!"
3. Try the menu: Shopify Analytics → Update Dashboard

### Step 3: Setup Automatic Triggers
1. In Google Sheets menu: Shopify Analytics → Settings
2. Run `setupTriggers()` function
3. This will update your dashboard every 6 hours automatically

## 🔄 Data Migration (Optional)

If you want to migrate your existing data from Google Sheets:

### Step 1: Export Current Data
1. In your current Google Sheets, export key sheets as CSV
2. Save ORDER_CACHE, SKU_CACHE, etc.

### Step 2: Use Migration Script
```javascript
// You can create a custom migration script based on your data format
// Example: src/migrations/migrate-from-sheets.js
```

## 🎯 Testing Everything

### API Endpoints Testing
```bash
# Test sync endpoint
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"shop": "pompdelux-da.myshopify.com", "type": "orders", "days": 1}' \
  "https://your-project.vercel.app/api/sync-shop"

# Test analytics endpoint
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-project.vercel.app/api/analytics?startDate=2024-01-01&endDate=2024-12-31"
```

### Google Sheets Testing
1. Set date range in B1 and B2 cells
2. Run: Shopify Analytics → Update Dashboard
3. Should see data populated in under 5 seconds!

## 🚨 Troubleshooting

### Common Issues

1. **API Key Errors**
   - Make sure API_SECRET_KEY is the same in Vercel and Google Sheets
   - Generate a strong 32+ character random key

2. **Supabase Connection Errors**
   - Verify SUPABASE_URL and SUPABASE_SERVICE_KEY
   - Check if tables were created properly

3. **Shopify Token Errors**
   - Verify tokens haven't expired
   - Check token permissions include orders, products, inventory

4. **Google Sheets "Authorization Error"**
   - Update API_BASE_URL to your actual Vercel URL
   - Make sure API_KEY matches your Vercel environment variable

### Performance Issues
- If requests timeout, try reducing the `days` parameter in sync calls
- For large datasets, consider running syncs in smaller chunks

## 📈 Monitoring & Maintenance

### Check Sync Logs
```sql
-- In Supabase SQL editor
SELECT * FROM sync_log
ORDER BY started_at DESC
LIMIT 20;
```

### Clean Old Logs (Run Monthly)
```sql
SELECT clean_old_sync_logs();
```

### Monitor Performance
- Watch Vercel function execution times
- Monitor Supabase database size
- Check Google Sheets script execution logs

## 🎉 Success Criteria

✅ **Your migration is successful when:**
1. `updateDashboard()` in Google Sheets completes in under 5 seconds
2. All 5 Shopify shops sync without errors
3. Data appears correctly in your dashboard
4. No timeout errors occur

## 📞 Support

If you encounter issues:
1. Check Vercel function logs
2. Check Google Apps Script execution transcript
3. Verify all environment variables are set correctly
4. Test individual components with the test scripts

Your new system should be **100x faster** and handle unlimited data! 🚀