// Google Apps Script - New Simplified Version
// Replace your existing Google Apps Script with this code

// 🔧 CONFIGURATION
const API_BASE_URL = 'https://your-shopify-analytics.vercel.app/api'; // Update this after deployment
const API_KEY = 'your-api-secret-key'; // Update this with your actual API key

/**
 * 🌐 Fetch data from API endpoint
 */
function fetchFromAPI(endpoint, params = {}) {
  const url = `${API_BASE_URL}${endpoint}?` + Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  console.log(`🌐 Calling API: ${endpoint}`);

  const response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`API Error (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}

/**
 * 📊 Update Dashboard Sheet
 */
function updateDashboard() {
  console.log('📊 Starting dashboard update...');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  if (!sheet) {
    throw new Error('Dashboard sheet not found');
  }

  // Read date range from sheet
  const startDate = sheet.getRange('B1').getValue();
  const endDate = sheet.getRange('B2').getValue();

  if (!startDate || !endDate) {
    throw new Error('Please set start date in B1 and end date in B2');
  }

  console.log(`📅 Fetching data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  try {
    // Fetch data from new API
    const result = fetchFromAPI('/analytics', {
      startDate: Utilities.formatDate(startDate, 'GMT', 'yyyy-MM-dd'),
      endDate: Utilities.formatDate(endDate, 'GMT', 'yyyy-MM-dd'),
      type: 'dashboard'
    });

    console.log(`✅ Received ${result.count} records`);

    // Clear old data (starting from row 5)
    sheet.getRange('A5:Z').clearContent();

    // Write headers
    if (result.headers && result.headers.length > 0) {
      sheet.getRange(4, 1, 1, result.headers.length).setValues([result.headers]);
    }

    // Write new data
    if (result.data && result.data.length > 0) {
      const startRow = 5;
      const numRows = result.data.length;
      const numCols = result.data[0].length;

      sheet.getRange(startRow, 1, numRows, numCols).setValues(result.data);

      console.log(`📝 Wrote ${numRows} rows to sheet`);
    }

    // Update timestamp
    sheet.getRange('A3').setValue(`Last updated: ${new Date()}`);

    console.log('✅ Dashboard updated successfully!');

  } catch (error) {
    console.error('❌ Dashboard update failed:', error);

    // Show error in sheet
    sheet.getRange('A3').setValue(`Error: ${error.message} (${new Date()})`);

    throw error;
  }
}

/**
 * 📈 Update SKU Analysis Sheet
 */
function updateSkuAnalysis() {
  console.log('📈 Starting SKU analysis update...');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SKU Analysis');
  if (!sheet) {
    console.log('⚠️ SKU Analysis sheet not found, skipping...');
    return;
  }

  // Read date range from Dashboard sheet
  const dashboardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  const startDate = dashboardSheet.getRange('B1').getValue();
  const endDate = dashboardSheet.getRange('B2').getValue();

  try {
    // You can customize this to fetch SKU-specific data
    const result = fetchFromAPI('/analytics', {
      startDate: Utilities.formatDate(startDate, 'GMT', 'yyyy-MM-dd'),
      endDate: Utilities.formatDate(endDate, 'GMT', 'yyyy-MM-dd'),
      type: 'raw' // Get raw data for SKU analysis
    });

    console.log(`✅ Received ${result.count} records for SKU analysis`);

    // Process and update SKU sheet as needed
    // This is where you'd implement your SKU-specific logic

  } catch (error) {
    console.error('❌ SKU analysis update failed:', error);
    throw error;
  }
}

/**
 * 🔄 Trigger Sync in Backend
 */
function triggerSync(shop, type, days = 7) {
  console.log(`🔄 Triggering sync: ${type} for ${shop}`);

  try {
    const result = fetchFromAPI('/sync-shop', {
      shop: shop,
      type: type,
      days: days
    });

    console.log(`✅ Sync completed: ${result.recordsSynced} records`);

    SpreadsheetApp.getUi().alert(
      `✅ Sync Successful`,
      `${result.recordsSynced} ${type} records synced for ${shop}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

    return result;

  } catch (error) {
    console.error('❌ Sync failed:', error);

    SpreadsheetApp.getUi().alert(
      `❌ Sync Failed`,
      `Error: ${error.message}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

    throw error;
  }
}

/**
 * 🔄 Sync All Shops (Orders)
 */
function syncAllShopsOrders() {
  const shops = [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ];

  console.log('🔄 Starting sync for all shops...');

  let totalSynced = 0;
  let results = [];

  for (const shop of shops) {
    try {
      console.log(`🔄 Syncing orders for ${shop}...`);
      const result = triggerSync(shop, 'orders', 1); // Last 1 day
      totalSynced += result.recordsSynced;
      results.push(`${shop}: ${result.recordsSynced} orders`);
    } catch (error) {
      console.error(`❌ Failed to sync ${shop}:`, error);
      results.push(`${shop}: FAILED - ${error.message}`);
    }
  }

  console.log(`✅ Sync completed. Total: ${totalSynced} records`);

  SpreadsheetApp.getUi().alert(
    `🔄 Sync All Shops Complete`,
    `Total records synced: ${totalSynced}\n\n${results.join('\n')}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * ⚙️ Show Settings Dialog
 */
function showSettings() {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3>📊 Shopify Analytics Settings</h3>
      <p><strong>API URL:</strong> ${API_BASE_URL}</p>
      <p><strong>Status:</strong> ${API_KEY ? '✅ API Key configured' : '❌ API Key missing'}</p>

      <h4>🔧 Setup Instructions:</h4>
      <ol>
        <li>Deploy your Node.js app to Vercel</li>
        <li>Update API_BASE_URL in this script</li>
        <li>Set your API_SECRET_KEY in this script</li>
        <li>Run the setup triggers</li>
      </ol>

      <h4>📋 Available Functions:</h4>
      <ul>
        <li><strong>updateDashboard()</strong> - Refresh dashboard data</li>
        <li><strong>syncAllShopsOrders()</strong> - Sync recent orders</li>
        <li><strong>triggerSync(shop, type, days)</strong> - Custom sync</li>
      </ul>
    </div>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(500)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '⚙️ Settings');
}

/**
 * 📱 Create Menu
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('📊 Shopify Analytics')
    .addItem('🔄 Update Dashboard', 'updateDashboard')
    .addItem('📈 Update SKU Analysis', 'updateSkuAnalysis')
    .addSeparator()
    .addItem('🔄 Sync All Shops (Orders)', 'syncAllShopsOrders')
    .addSubMenu(ui.createMenu('🔄 Manual Sync')
      .addItem('📦 Danish Shop - Orders', 'syncDanishOrders')
      .addItem('📦 German Shop - Orders', 'syncGermanOrders')
      .addItem('🏷️ All Shops - SKUs', 'syncAllSkus'))
    .addSeparator()
    .addItem('⚙️ Settings', 'showSettings')
    .addToUi();
}

/**
 * 🕐 Setup Automatic Triggers
 */
function setupTriggers() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });

  // Create new trigger for hourly updates
  ScriptApp.newTrigger('updateDashboard')
    .timeBased()
    .everyHours(6) // Every 6 hours
    .create();

  // Create trigger for daily sync
  ScriptApp.newTrigger('syncAllShopsOrders')
    .timeBased()
    .everyDays(1)
    .atHour(8) // 8 AM
    .create();

  console.log('✅ Triggers setup complete');

  SpreadsheetApp.getUi().alert(
    '✅ Triggers Setup Complete',
    'Automatic updates will run:\n• Dashboard: Every 6 hours\n• Sync orders: Daily at 8 AM',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// 🎯 QUICK SYNC FUNCTIONS
function syncDanishOrders() { triggerSync('pompdelux-da.myshopify.com', 'orders', 3); }
function syncGermanOrders() { triggerSync('pompdelux-de.myshopify.com', 'orders', 3); }
function syncAllSkus() {
  const shops = ['pompdelux-da.myshopify.com', 'pompdelux-de.myshopify.com'];
  shops.forEach(shop => triggerSync(shop, 'skus', 7));
}

/**
 * 🧪 Test API Connection
 */
function testApiConnection() {
  console.log('🧪 Testing API connection...');

  try {
    // Test basic connectivity
    const response = UrlFetchApp.fetch(`${API_BASE_URL}/analytics?startDate=2024-01-01&endDate=2024-01-01`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    console.log(`📡 API Response: ${statusCode}`);

    if (statusCode === 200) {
      SpreadsheetApp.getUi().alert('✅ API Connection Successful!');
    } else if (statusCode === 401) {
      SpreadsheetApp.getUi().alert('❌ API Key Invalid', 'Check your API_SECRET_KEY configuration.');
    } else {
      SpreadsheetApp.getUi().alert(`❌ API Error: ${statusCode}`, response.getContentText());
    }

  } catch (error) {
    console.error('❌ Connection test failed:', error);
    SpreadsheetApp.getUi().alert('❌ Connection Failed', error.message);
  }
}