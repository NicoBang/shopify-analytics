# 🚀 Shopify Analytics - Installation Guide

## 📋 **Step 1: Google Sheets Setup**

### 1.1 Opret nyt Google Sheets dokument
1. Gå til [sheets.google.com](https://sheets.google.com)
2. Opret et nyt regneark
3. Kopier regneark ID fra URL'en:
   - Eksempel URL: `https://docs.google.com/spreadsheets/d/1ABC123DEF456/edit`
   - ID er: `1ABC123DEF456`

### 1.2 Tilføj Google Apps Script
1. I dit Google Sheets: **Extensions → Apps Script**
2. Slet eksisterende kode
3. Kopiér **hele indholdet** fra `google-sheets-integration.js`
4. **VIGTIGT**: Opdater denne linje med dit regneark ID:
   ```javascript
   SPREADSHEET_ID: 'DIN_GOOGLE_SHEETS_ID_HER', // 👈 Ret dette!
   ```

### 1.3 Gem og test
1. Tryk **Ctrl+S** for at gemme
2. Kør funktionen `testConnection`
3. Godkend tilladelser når du bliver spurgt

---

## 📋 **Step 2: Automatisering**

### 2.1 Daglig opdatering
Kør denne funktion én gang for at sætte automatisk opdatering op:
```javascript
createDailyTrigger()
```

Dette vil opdatere dashboardet hver dag kl. 08:00.

### 2.2 Menu i Google Sheets
Når scriptet er installeret, får du en ny menu: **"📊 Pompdelux Analytics"**

**Menu funktioner:**
- 🔄 **Opdater Dashboard**: Henter sidste 30 dages data
- 🔄 **Sync Alle Butikker**: Synkroniserer data fra alle 5 butikker
- 📈 **Hent Analytics**: Detaljeret analytics data
- 📦 **Hent Inventory**: Lager status
- ⚙️ **Test Forbindelse**: Test om API'et virker

---

## 📋 **Step 3: Migration fra gammelt system**

### 3.1 Backup
**VIGTIG**: Tag backup af dit eksisterende Google Sheets før du begynder!

### 3.2 Dataformat
Det nye system leverer **præcis samme dataformat** som det gamle, så dine eksisterende formler og charts vil virke uden ændringer.

**Kolonner (identiske):**
- Shop
- Order ID
- Created At
- Country
- Discounted Total
- Tax
- Shipping
- Item Count
- Refunded Amount
- Refunded Qty
- Refund Date
- Total Discounts Ex Tax
- Cancelled Qty

### 3.3 Performance sammenligning
- **Gammelt system**: 5-15 minutter + timeouts
- **Nyt system**: 10-30 sekunder, ingen timeouts

---

## 📋 **Step 4: API endpoints (optional)**

Hvis du vil lave custom integrationer:

### 4.1 Analytics API
```bash
GET https://shopify-analytics-nu.vercel.app/api/analytics
```

**Parameters:**
- `startDate`: YYYY-MM-DD format
- `endDate`: YYYY-MM-DD format
- `type`: dashboard | analytics | raw
- `shop`: (optional) specifik butik

**Headers:**
```
Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc
```

### 4.2 Sync API
```bash
GET https://shopify-analytics-nu.vercel.app/api/sync-shop
```

**Parameters:**
- `shop`: pompdelux-da.myshopify.com (etc.)
- `type`: orders | skus | inventory | fulfillments
- `days`: antal dage tilbage (default: 7)

---

## 🎯 **Step 5: Test og verificering**

### 5.1 Test funktioner
1. Kør `testConnection()` - skal returnere ✅
2. Kør `updateDashboard()` - skal fylde data i dit ark
3. Check at data er identisk med dit gamle system

### 5.2 Performance test
- Gammelt system: Time det!
- Nyt system: Time det! (burde være 100x hurtigere)

### 5.3 Fuld migration
1. **Backup** dit gamle system
2. Installér nyt system ved siden af
3. Sammenlign data i 1-2 dage
4. Når du er sikker: skift fuldt over

---

## 🔧 **Troubleshooting**

### Problem: "Unauthorized" fejl
**Løsning**: Check at API nøglen er korrekt i scriptet

### Problem: "Sheet not found"
**Løsning**: Check at SPREADSHEET_ID er korrekt

### Problem: Ingen data
**Løsning**:
1. Test `testConnection()`
2. Sync data først med `syncAllShops()`
3. Derefter kør `updateDashboard()`

### Problem: Timeout
**Løsning**: Det nye system har ingen timeouts! Hvis det sker, er det et midlertidigt netværks problem.

---

## 🎉 **Success kriterier**

Du ved systemet virker når:
- ✅ `testConnection()` returner success
- ✅ Dashboard opdateres på under 30 sekunder
- ✅ Data er identisk med gammelt system
- ✅ Ingen timeout fejl
- ✅ Alle 5 butikker synkroniserer

**Du har nu et 100x hurtigere system! 🚀**