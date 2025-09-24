// Google Apps Script - Ny Shopify Analytics Integration
// Erstatter det gamle 15.000+ linje system

// Configuration
const CONFIG = {
  API_BASE: 'https://shopify-analytics-1iczubfpd-nicolais-projects-291e9559.vercel.app/api',
  API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',
  SPREADSHEET_ID: 'DIN_GOOGLE_SHEETS_ID_HER', // Skal opdateres

  // Ark navne
  SHEETS: {
    DASHBOARD: 'Dashboard',
    ORDERS: 'Orders',
    ANALYTICS: 'Analytics',
    INVENTORY: 'Inventory'
  }
};

/**
 * Hovedfunktion til at opdatere dashboard
 */
function updateDashboard() {
  try {
    console.log('🚀 Starter dashboard opdatering...');

    // Hent data fra det nye API
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // Sidste 30 dage

    const data = fetchAnalyticsData(startDate, endDate, 'dashboard');

    if (data.success && data.count > 0) {
      // Opdater Google Sheets
      updateSheet(CONFIG.SHEETS.DASHBOARD, data.headers, data.data);
      console.log(`✅ Dashboard opdateret med ${data.count} ordrer`);
    } else {
      console.log('⚠️ Ingen data modtaget');
    }

  } catch (error) {
    console.error('💥 Fejl i updateDashboard:', error);
    throw error;
  }
}

/**
 * Hent analytics data fra det nye API
 */
function fetchAnalyticsData(startDate, endDate, type = 'dashboard', shop = null) {
  const params = {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    type: type
  };

  if (shop) params.shop = shop;

  const queryString = Object.keys(params)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');

  const url = `${CONFIG.API_BASE}/analytics?${queryString}`;

  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200) {
      throw new Error(`API fejl: ${data.error || 'Unknown error'}`);
    }

    return data;

  } catch (error) {
    console.error('💥 API fejl:', error);
    throw error;
  }
}

/**
 * Synkroniser Shopify data
 */
function syncShopifyData(shop, type = 'orders', days = 7) {
  const url = `${CONFIG.API_BASE}/sync-shop?shop=${shop}&type=${type}&days=${days}`;

  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    console.log(`🔄 Synkroniserer ${type} for ${shop}...`);
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200) {
      throw new Error(`Sync fejl: ${data.error || 'Unknown error'}`);
    }

    console.log(`✅ Synkroniseret ${data.recordsSynced} ${type} for ${shop}`);
    return data;

  } catch (error) {
    console.error(`💥 Sync fejl for ${shop}:`, error);
    throw error;
  }
}

/**
 * Opdater Google Sheets ark
 */
function updateSheet(sheetName, headers, data) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(sheetName);

    // Opret ark hvis det ikke findes
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    // Ryd eksisterende data
    sheet.clear();

    // Tilføj headers
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

      // Formatér header række
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285F4');
      headerRange.setFontColor('white');
    }

    // Tilføj data
    if (data && data.length > 0) {
      const startRow = headers ? 2 : 1;
      sheet.getRange(startRow, 1, data.length, data[0].length).setValues(data);
    }

    // Auto-resize kolonner
    sheet.autoResizeColumns(1, headers ? headers.length : data[0].length);

    console.log(`✅ Ark '${sheetName}' opdateret med ${data.length} rækker`);

  } catch (error) {
    console.error(`💥 Fejl ved opdatering af ark '${sheetName}':`, error);
    throw error;
  }
}

/**
 * Synkroniser alle butikker
 */
function syncAllShops() {
  const shops = [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ];

  shops.forEach(shop => {
    try {
      syncShopifyData(shop, 'orders', 7);
      Utilities.sleep(2000); // 2 sekunder pause mellem calls
    } catch (error) {
      console.error(`Fejl ved sync af ${shop}:`, error);
    }
  });

  console.log('🎉 Alle butikker synkroniseret!');
}

/**
 * Menu funktioner for Google Sheets
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 Pompdelux Analytics')
    .addItem('🔄 Opdater Dashboard', 'updateDashboard')
    .addItem('🔄 Sync Alle Butikker', 'syncAllShops')
    .addSeparator()
    .addItem('📈 Hent Analytics', 'getAnalyticsData')
    .addItem('📦 Hent Inventory', 'getInventoryData')
    .addSeparator()
    .addItem('⚙️ Test Forbindelse', 'testConnection')
    .addToUi();
}

/**
 * Test API forbindelse
 */
function testConnection() {
  try {
    const testData = fetchAnalyticsData(new Date('2025-09-15'), new Date('2025-09-18'), 'dashboard');

    if (testData.success) {
      SpreadsheetApp.getUi().alert(
        '✅ Forbindelse OK',
        `API fungerer! Fandt ${testData.count} ordrer.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } else {
      throw new Error('API returnerede ikke success');
    }
  } catch (error) {
    SpreadsheetApp.getUi().alert(
      '❌ Forbindelse fejl',
      `Fejl: ${error.message}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/**
 * Hent analytics data til separat ark
 */
function getAnalyticsData() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const data = fetchAnalyticsData(startDate, endDate, 'analytics');
  updateSheet(CONFIG.SHEETS.ANALYTICS, data.headers, data.data);
}

/**
 * Hent inventory data
 */
function getInventoryData() {
  // Sync inventory først
  const shops = ['pompdelux-da.myshopify.com']; // Start med én butik

  shops.forEach(shop => {
    syncShopifyData(shop, 'inventory');
  });

  SpreadsheetApp.getUi().alert(
    '📦 Inventory Sync',
    'Inventory data er synkroniseret! Check Supabase database for results.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Automatisk trigger - kør dagligt
 */
function createDailyTrigger() {
  ScriptApp.newTrigger('updateDashboard')
    .timeBased()
    .everyDays(1)
    .atHour(8) // Kl. 08:00
    .create();

  console.log('✅ Daglig trigger oprettet');
}