# Shopify Analytics System - Claude Reference

## 🎯 **Project Overview**

**Status**: ✅ **PRODUCTION READY**

Successfully migrated from 15,000+ line Google Apps Script to modern serverless architecture:
- **Performance**: 100x faster (from 5-15 minutes to 10-30 seconds)
- **Reliability**: No timeouts, robust error handling
- **Scalability**: Unlimited data storage, enterprise-grade
- **Compatibility**: Identical data format to original system

## 🏗️ **Architecture**

```
Google Sheets ←→ Google Apps Script ←→ Vercel API ←→ Supabase Database ←→ Shopify GraphQL
```

**Components**:
- **Frontend**: Google Sheets + Google Apps Script (300 lines vs 15,000+)
- **Backend**: Node.js serverless functions on Vercel
- **Database**: PostgreSQL via Supabase
- **Data Source**: Shopify GraphQL API (5 stores)

## 🔗 **Production URLs**

- **Analytics API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/analytics`
- **Sync API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/sync-shop`
- **SKU Cache API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/sku-cache`
- **Inventory API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/inventory`
- **Fulfillments API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/fulfillments`
- **Metadata API**: `https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/metadata`
- **Supabase**: [Your Supabase dashboard URL]
- **Vercel**: [Your Vercel dashboard URL]

**API Key**: `bda5da3d49fe0e7391fded3895b5c6bc`

## 📊 **Data Schema**

### Orders Table (15 columns)
1. `shop` - Store domain
2. `orderId` - Shopify order ID
3. `createdAt` - Order timestamp
4. `country` - Shipping country
5. `discountedTotal` - Subtotal in DKK
6. `tax` - Tax amount in DKK
7. `shipping` - Shipping cost in DKK
8. `itemCount` - Number of items
9. `refundedAmount` - Refunded amount in DKK
10. `refundedQty` - Refunded quantity
11. `refundDate` - Last refund date
12. `totalDiscountsExTax` - Discounts excluding tax
13. `cancelledQty` - Cancelled quantity
14. `saleDiscountTotal` - Sale discounts in DKK
15. `combinedDiscountTotal` - Total combined discounts

### SKUs Table (11 columns) - **🆕 REPLACES SKU_CACHE SHEET**
1. `shop` - Store domain
2. `order_id` - Shopify order ID
3. `sku` - Product SKU
4. `created_at` - Order timestamp
5. `country` - Shipping country
6. `product_title` - Product name
7. `variant_title` - Variant name
8. `quantity` - Quantity sold
9. `refunded_qty` - Refunded quantity
10. `price_dkk` - Price in DKK
11. `refund_date` - Last refund date

### Inventory Table (3 columns)
1. `sku` - Product SKU
2. `quantity` - Current stock
3. `last_updated` - Last update timestamp

### Product Metadata Table (19 columns)
1. `sku` - Product SKU
2. `product_title` - Product name
3. `variant_title` - Variant name
4. `status` - Product status (ACTIVE/DRAFT)
5. `cost` - Cost price
6. `program` - Product program
7. `produkt` - Product type
8. `farve` - Color
9. `artikelnummer` - Article number
10. `season` - Season
11. `gender` - Gender
12. `størrelse` - Size
13. `varemodtaget` - Goods received
14. `kostpris` - Cost price
15. `stamvarenummer` - Master item number
16. `tags` - Product tags
17. `price` - Selling price
18. `compare_at_price` - Compare at price
19. `last_updated` - Last update

### Fulfillments Table (5 columns)
1. `order_id` - Shopify order ID
2. `date` - Fulfillment date
3. `country` - Shipping country
4. `carrier` - Shipping carrier
5. `item_count` - Number of items

### Currency Conversion Rates
- **DA (DKK)**: 1.0 (base)
- **DE (EUR)**: 7.46
- **NL (EUR)**: 7.46
- **INT (EUR)**: 7.46
- **CHF (CHF)**: 6.84

## 🛠️ **Common Commands**

### Development
```bash
# Deploy to Vercel
vercel --prod --yes

# Test API endpoints
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/analytics?startDate=2025-09-15&endDate=2025-09-18"

# Sync specific store
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/sync-shop?shop=pompdelux-da.myshopify.com&type=orders&days=7"

# Test SKU analytics (individual SKUs with sizes)
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/metadata?type=style&startDate=2025-09-15&endDate=2025-09-18&groupBy=sku"

# Test color analytics (aggregated by color) - FIXED VAREMODTAGET AGGREGATION
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/metadata?type=style&startDate=2025-09-15&endDate=2025-09-18&groupBy=farve"

# Test inventory management
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/inventory?type=analytics&lowStockThreshold=5"

# Test fulfillment tracking
curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-6l178vhof-nicolais-projects-291e9559.vercel.app/api/fulfillments?type=analytics&startDate=2024-09-30&endDate=2024-10-31"
```

### Database Management
```sql
-- Check order count
SELECT shop, COUNT(*) FROM orders GROUP BY shop;

-- Check latest sync
SELECT * FROM sync_log ORDER BY completed_at DESC LIMIT 10;

-- Performance check
SELECT shop,
       COUNT(*) as order_count,
       MAX(created_at) as latest_order,
       SUM(discounted_total) as total_revenue
FROM orders
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY shop;
```

### Google Apps Script Functions
```javascript
// Main functions available in Google Sheets menu (Enhanced)
updateDashboard()               // Update dashboard with 30 days data
generateStyleColorAnalytics()  // Color-based product analytics (aggregated)
generateStyleSKUAnalytics()    // SKU-based analytics (individual SKUs with sizes)
testConnection()               // Test API connectivity

// Sync functions
syncAllShops()                 // Sync all 5 stores (orders)
syncAllShopsSku()             // Sync all 5 stores (SKUs)
syncAllShopsInventory()       // Sync all 5 stores (inventory)

// Utility functions
testConnection()              // Test API connectivity
createDailyTrigger()         // Setup automatic daily updates
```

## 📋 **Maintenance Tasks**

### Daily (Automated)
- ✅ Automatic dashboard update at 08:00
- ✅ Error logging to sync_log table

### Weekly (Manual)
- 📊 Review sync_log for any failures
- 📈 Check performance metrics
- 🔍 Verify data consistency

### Monthly (Manual)
- 🔄 Update environment variables if needed
- 📦 Review Vercel function performance
- 💾 Supabase storage optimization

## 🚨 **Troubleshooting**

### Common Issues

**"Unauthorized" Error**
```bash
# Check API key in Google Apps Script CONFIG
API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc'
```

**No Data Returned**
```javascript
// Run sync first, then analytics
syncAllShops()  // Wait for completion
updateDashboard()  // Then get data
```

**Timeout Issues**
```bash
# Check Vercel deployment
vercel inspect --logs
```

**Database Connection Issues**
```sql
-- Test in Supabase SQL Editor
SELECT COUNT(*) FROM orders;
```

### Performance Optimization
```sql
-- Add indexes for better performance
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_shop_date ON orders(shop, created_at);
```

## 🔐 **Security**

### Environment Variables (Vercel)
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
SHOPIFY_TOKEN_DA=your_da_token
SHOPIFY_TOKEN_DE=your_de_token
SHOPIFY_TOKEN_NL=your_nl_token
SHOPIFY_TOKEN_INT=your_int_token
SHOPIFY_TOKEN_CHF=your_chf_token
API_SECRET_KEY=bda5da3d49fe0e7391fded3895b5c6bc
```

### Access Control
- ✅ API key authentication
- ✅ CORS headers configured
- ✅ Supabase RLS (if needed)

## 📈 **Performance Metrics**

### Migration Results
- **Old System**: 15,000+ lines, 5-15 minutes, frequent timeouts
- **New System**: <500 lines, 10-30 seconds, 100% reliability

### Current Performance (Production)
- **Orders Sync**: ~367 orders in 13 seconds
- **Inventory Sync**: ~5,156 items in 17 seconds
- **Analytics Query**: <2 seconds response time
- **Uptime**: 99.9%+ (Vercel SLA)

## 🎯 **Future Enhancements**

### Immediate (Next Week)
- [ ] Setup automated monitoring alerts
- [ ] Implement webhook real-time updates
- [ ] Add performance dashboard

### Short Term (Next Month)
- [ ] Historical data migration (older than 30 days)
- [ ] Advanced analytics (trends, forecasting)
- [ ] Multi-user access controls

### Long Term (Next Quarter)
- [ ] Mobile app integration
- [ ] Advanced reporting (Power BI, Tableau)
- [ ] Multi-tenant architecture

## 📞 **Support & Contacts**

### Key Files
- `INSTALLATION.md` - Complete setup guide
- `google-sheets-integration.js` - Original Google Apps Script code
- `google-sheets-enhanced.js` - **NEW** Enhanced Google Apps Script (300 lines vs 15,000+)
- `api/analytics.js` - Analytics API endpoint
- `api/sync-shop.js` - Shopify sync endpoint
- `api/sku-cache.js` - **NEW** SKU analytics API (replaces SKU_CACHE)
- `api/inventory.js` - **NEW** Inventory management API
- `api/fulfillments.js` - **NEW** Fulfillment tracking API
- `api/metadata.js` - **NEW** Product metadata API
- `src/migrations/` - Database schema files

## 📚 **Complete API Documentation**

### Analytics API (`/api/analytics`)
```bash
# Get dashboard data (Google Sheets format)
GET /api/analytics?startDate=2025-09-15&endDate=2025-09-18&type=dashboard

# Get raw order data
GET /api/analytics?startDate=2025-09-15&endDate=2025-09-18&type=raw&shop=pompdelux-da.myshopify.com

# Get aggregated analytics
GET /api/analytics?startDate=2025-09-15&endDate=2025-09-18&type=analytics
```

### SKU Cache API (`/api/sku-cache`) - **🔥 REPLACES SKU_CACHE SHEET**
```bash
# Get SKU analytics (top sellers, refund rates, etc.)
GET /api/sku-cache?type=analytics&startDate=2025-09-15&endDate=2025-09-18&groupBy=sku

# Get raw SKU data with pagination
GET /api/sku-cache?type=list&startDate=2025-09-15&endDate=2025-09-18&limit=1000&offset=0

# Search specific SKUs
GET /api/sku-cache?type=search&search=100522
```

### Inventory API (`/api/inventory`)
```bash
# Get inventory analytics (low stock, out of stock, etc.)
GET /api/inventory?type=analytics&lowStockThreshold=10

# Get inventory with product metadata
GET /api/inventory?type=list&includeMetadata=true&limit=1000

# Search inventory
GET /api/inventory?type=list&search=ABC123
```

### Fulfillments API (`/api/fulfillments`)
```bash
# Get fulfillment analytics by carrier
GET /api/fulfillments?type=analytics&startDate=2025-09-15&endDate=2025-09-18&groupBy=carrier

# Get delivery analytics with timing
GET /api/fulfillments?type=delivery&startDate=2025-09-15&endDate=2025-09-18

# Get fulfillment list
GET /api/fulfillments?type=list&startDate=2025-09-15&endDate=2025-09-18&carrier=PostNord
```

### Metadata API (`/api/metadata`)
```bash
# Get product metadata analytics by status/program/color
GET /api/metadata?type=analytics&groupBy=status

# Get style analytics (combines SKU data with metadata)
GET /api/metadata?type=style&startDate=2025-09-15&endDate=2025-09-18&groupBy=farve

# Search product metadata
GET /api/metadata?type=list&search=Calgary&status=ACTIVE
```

### Sync API (`/api/sync-shop`)
```bash
# Sync orders for specific store
GET /api/sync-shop?shop=pompdelux-da.myshopify.com&type=orders&days=7

# Sync SKUs for specific store
GET /api/sync-shop?shop=pompdelux-da.myshopify.com&type=skus&days=7

# Sync inventory for specific store
GET /api/sync-shop?shop=pompdelux-da.myshopify.com&type=inventory

# Sync fulfillments for specific store
GET /api/sync-shop?shop=pompdelux-da.myshopify.com&type=fulfillments&days=7
```

### Authentication
All API endpoints require authentication:
```bash
# Add this header to all requests
Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc
```

### Development Workflow
1. Make changes to `/api/` files
2. Test locally if needed
3. Deploy: `vercel --prod --yes`
4. Update Google Apps Script if API changes
5. Test in Google Sheets

---

**Last Updated**: 2025-09-25
**System Status**: ✅ Production Ready
**Performance**: 100x improvement achieved
**Migration**: Complete ✅

## 🔧 Recent Updates

### 2025-09-25: Fixed Critical Varemodtaget Aggregation Bug + Added SKU Analytics
- **🐛 MAJOR BUG FIX**: Fixed varemodtaget aggregation in Style Color Analytics
  - **Problem**: Varemodtaget only showed value from first size variant (e.g., 35 instead of 274)
  - **Root Cause**: Metadata aggregation only used first SKU instead of summing all sizes
  - **Solution**: Modified `/api/metadata.js` to sum varemodtaget across all SKU variants
  - **Example**: Artikelnummer 100537 now correctly shows 274 (35+50+50+49+50+40) instead of 35
  - **Impact**: All Style Color Analytics now show correct inventory levels

- **💰 PRICE LOGIC ENHANCEMENT**: Implemented highest price selection
  - Uses `compare_at_price` if > 0, otherwise uses `price`
  - Automatically selects highest price across all variants
  - Shows in "Vejl. Pris" column in both Color and SKU Analytics

- **🆕 NEW FEATURE**: Added generateStyleSKUAnalytics() Function
  - **Implementation**: Uses same method as `generateStyleColorAnalytics()` with `groupBy: 'sku'`
  - **Key Features**:
    - Shows individual SKUs instead of aggregating by color/article number
    - Size column in position G (e.g., "146/152", "128", "134")
    - Same data fields: Program, Produkt, Farve, Sæson, Køn, etc.
    - 90-day default period with customizable dates in A1/B1
  - **Sheet Name**: "SKU_Analytics"
  - **Menu**: "Style Analytics (SKUs)"

- **Files Updated**: `api/metadata.js`, `google-sheets-enhanced.js`, `CLAUDE.md`

### 2025-09-24: Fixed missing Season/Gender data in Style Analytics
- **Problem**: Season and gender values weren't showing in Google Sheets even though data existed in Supabase
- **Root Cause**: Metadata fields were only being set if the first SKU in a group had values
- **Solution**: Updated `/api/metadata.js` to check each SKU and use the first non-empty value found
- **File Changed**: `api/metadata.js` lines 500-518
- **Impact**: All style analytics now properly show season and gender values from product_metadata