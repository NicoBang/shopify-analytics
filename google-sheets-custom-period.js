// Google Apps Script - Custom Period Analytics Functions
// Henter data for enhver tidsperiode uden timeouts

/**
 * Configuration
 */
const CUSTOM_CONFIG = {
  API_BASE: 'https://shopify-analytics-1iczubfpd-nicolais-projects-291e9559.vercel.app/api',
  API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',

  // Shops
  SHOPS: [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ]
};

/**
 * Hent SKU data for en custom periode
 * @param {string} startDate - Start dato (YYYY-MM-DD)
 * @param {string} endDate - Slut dato (YYYY-MM-DD)
 * @param {string} shop - Valgfri specifik butik (default: alle)
 * @returns {object} Data summary
 */
function getCustomPeriodData(startDate, endDate, shop = null) {
  console.log(`📊 Fetching data from ${startDate} to ${endDate}`);

  try {
    // Build URL with parameters
    let url = `${CUSTOM_CONFIG.API_BASE}/sku-raw?startDate=${startDate}&endDate=${endDate}&limit=all`;

    if (shop) {
      url += `&shop=${shop}`;
    }

    console.log('🔍 API URL:', url);

    // Fetch data
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CUSTOM_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const result = JSON.parse(response.getContentText());

      console.log('✅ Data fetched successfully:');
      console.log(`  Total Records: ${result.summary.totalRecords}`);
      console.log(`  Total Quantity Sold: ${result.summary.totalQuantitySold}`);
      console.log(`  Total Revenue (DKK): ${result.summary.totalRevenue}`);
      console.log(`  Unique SKUs: ${result.summary.uniqueSkus}`);

      return result;
    } else {
      throw new Error(`API returned status ${response.getResponseCode()}`);
    }

  } catch (error) {
    console.error('❌ Error fetching data:', error.message);
    throw error;
  }
}

/**
 * Hent data for hele 2024
 */
function getYear2024Data() {
  const ui = SpreadsheetApp.getUi();

  try {
    console.log('📅 Fetching 2024 full year data...');
    const data = getCustomPeriodData('2024-01-01', '2024-12-31');

    const message = `2024 Full Year Summary:

📊 Total Records: ${data.summary.totalRecords}
📦 Total Quantity Sold: ${data.summary.totalQuantitySold}
↩️ Total Refunded: ${data.summary.totalQuantityRefunded}
📈 Net Quantity Sold: ${data.summary.netQuantitySold}
💰 Total Revenue (DKK): ${data.summary.totalRevenue}
🏷️ Unique SKUs: ${data.summary.uniqueSkus}
📋 Unique Orders: ${data.summary.uniqueOrders}
🏪 Unique Shops: ${data.summary.uniqueShops}`;

    ui.alert('2024 Data', message, ui.ButtonSet.OK);
    return data;

  } catch (error) {
    ui.alert('Error', 'Failed to fetch 2024 data: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Hent data for hele 2025 (år til dato)
 */
function getYear2025YTD() {
  const ui = SpreadsheetApp.getUi();

  try {
    // Get current date
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];

    console.log(`📅 Fetching 2025 YTD data (until ${endDate})...`);
    const data = getCustomPeriodData('2025-01-01', endDate);

    const message = `2025 Year-to-Date Summary:

📊 Total Records: ${data.summary.totalRecords}
📦 Total Quantity Sold: ${data.summary.totalQuantitySold}
↩️ Total Refunded: ${data.summary.totalQuantityRefunded}
📈 Net Quantity Sold: ${data.summary.netQuantitySold}
💰 Total Revenue (DKK): ${data.summary.totalRevenue}
🏷️ Unique SKUs: ${data.summary.uniqueSkus}
📋 Unique Orders: ${data.summary.uniqueOrders}
🏪 Unique Shops: ${data.summary.uniqueShops}`;

    ui.alert('2025 YTD Data', message, ui.ButtonSet.OK);
    return data;

  } catch (error) {
    ui.alert('Error', 'Failed to fetch 2025 YTD data: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Hent data med custom dato valg (UI prompt)
 */
function getCustomPeriodWithPrompt() {
  const ui = SpreadsheetApp.getUi();

  // Get start date
  const startResponse = ui.prompt(
    'Custom Period',
    'Enter start date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (startResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  // Get end date
  const endResponse = ui.prompt(
    'Custom Period',
    'Enter end date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (endResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const startDate = startResponse.getResponseText();
  const endDate = endResponse.getResponseText();

  try {
    console.log(`📅 Fetching custom period: ${startDate} to ${endDate}`);
    const data = getCustomPeriodData(startDate, endDate);

    const message = `Custom Period Summary (${startDate} to ${endDate}):

📊 Total Records: ${data.summary.totalRecords}
📦 Total Quantity Sold: ${data.summary.totalQuantitySold}
↩️ Total Refunded: ${data.summary.totalQuantityRefunded}
📈 Net Quantity Sold: ${data.summary.netQuantitySold}
💰 Total Revenue (DKK): ${data.summary.totalRevenue}
🏷️ Unique SKUs: ${data.summary.uniqueSkus}
📋 Unique Orders: ${data.summary.uniqueOrders}
🏪 Unique Shops: ${data.summary.uniqueShops}`;

    ui.alert('Custom Period Data', message, ui.ButtonSet.OK);
    return data;

  } catch (error) {
    ui.alert('Error', 'Failed to fetch custom period data: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Quarterly data functions
 */
function getQ1_2024() { return getCustomPeriodData('2024-01-01', '2024-03-31'); }
function getQ2_2024() { return getCustomPeriodData('2024-04-01', '2024-06-30'); }
function getQ3_2024() { return getCustomPeriodData('2024-07-01', '2024-09-30'); }
function getQ4_2024() { return getCustomPeriodData('2024-10-01', '2024-12-31'); }

function getQ1_2025() { return getCustomPeriodData('2025-01-01', '2025-03-31'); }
function getQ2_2025() { return getCustomPeriodData('2025-04-01', '2025-06-30'); }
function getQ3_2025() { return getCustomPeriodData('2025-07-01', '2025-09-30'); }
function getQ4_2025() { return getCustomPeriodData('2025-10-01', '2025-12-31'); }

/**
 * Compare periods
 */
function comparePeriods() {
  const ui = SpreadsheetApp.getUi();

  try {
    console.log('📊 Comparing Q1 2024 vs Q1 2025...');

    const q1_2024 = getCustomPeriodData('2024-01-01', '2024-03-31');
    const q1_2025 = getCustomPeriodData('2025-01-01', '2025-03-31');

    const growth = ((q1_2025.summary.totalQuantitySold - q1_2024.summary.totalQuantitySold) / q1_2024.summary.totalQuantitySold * 100).toFixed(1);
    const revenueGrowth = ((parseFloat(q1_2025.summary.totalRevenue) - parseFloat(q1_2024.summary.totalRevenue)) / parseFloat(q1_2024.summary.totalRevenue) * 100).toFixed(1);

    const message = `Q1 Comparison (2024 vs 2025):

📅 Q1 2024:
  📦 Quantity Sold: ${q1_2024.summary.totalQuantitySold}
  💰 Revenue: ${q1_2024.summary.totalRevenue} DKK
  🏷️ Unique SKUs: ${q1_2024.summary.uniqueSkus}

📅 Q1 2025:
  📦 Quantity Sold: ${q1_2025.summary.totalQuantitySold}
  💰 Revenue: ${q1_2025.summary.totalRevenue} DKK
  🏷️ Unique SKUs: ${q1_2025.summary.uniqueSkus}

📈 Growth:
  📦 Quantity Growth: ${growth}%
  💰 Revenue Growth: ${revenueGrowth}%`;

    ui.alert('Q1 Comparison', message, ui.ButtonSet.OK);

  } catch (error) {
    ui.alert('Error', 'Failed to compare periods: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Export data to sheet
 */
function exportCustomPeriodToSheet(startDate, endDate, sheetName = 'Custom_Period_Data') {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  try {
    console.log(`📊 Exporting data from ${startDate} to ${endDate} to sheet...`);

    // Get data with artikelnummer aggregation
    const url = `${CUSTOM_CONFIG.API_BASE}/sku-raw?startDate=${startDate}&endDate=${endDate}&aggregateBy=artikelnummer&limit=all`;

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CUSTOM_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error('Failed to fetch data');
    }

    const result = JSON.parse(response.getContentText());

    // Create or get sheet
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    // Clear existing content
    sheet.clear();

    // Add headers
    const headers = [
      'Period',
      'Artikelnummer',
      'Total Quantity',
      'Total Refunded',
      'Net Quantity',
      'Total Revenue (DKK)',
      'SKU Count'
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // Add data
    if (result.aggregated && result.aggregated.length > 0) {
      const rows = result.aggregated.map(item => [
        `${startDate} to ${endDate}`,
        item.artikelnummer,
        item.totalQuantity,
        item.totalRefunded,
        item.totalQuantity - item.totalRefunded,
        item.totalRevenue.toFixed(2),
        item.skuCount
      ]);

      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

      // Add summary row
      const summaryRow = [
        'TOTAL',
        '',
        result.summary.totalQuantitySold,
        result.summary.totalQuantityRefunded,
        result.summary.netQuantitySold,
        result.summary.totalRevenue,
        result.summary.uniqueSkus
      ];

      const lastRow = rows.length + 3;
      sheet.getRange(lastRow, 1, 1, headers.length).setValues([summaryRow]);
      sheet.getRange(lastRow, 1, 1, headers.length).setFontWeight('bold');

      // Auto-resize columns
      for (let i = 1; i <= headers.length; i++) {
        sheet.autoResizeColumn(i);
      }

      console.log(`✅ Exported ${result.aggregated.length} artikelnummer to sheet`);
      SpreadsheetApp.getUi().alert('Success', `Exported ${result.aggregated.length} artikelnummer to ${sheetName}`, SpreadsheetApp.getUi().ButtonSet.OK);

    } else {
      throw new Error('No data to export');
    }

  } catch (error) {
    console.error('❌ Export failed:', error);
    SpreadsheetApp.getUi().alert('Export Failed', error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Add menu items
 */
function onOpen_CustomPeriod() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 Custom Period Analytics')
    .addItem('📅 Get 2024 Full Year', 'getYear2024Data')
    .addItem('📅 Get 2025 YTD', 'getYear2025YTD')
    .addItem('🎯 Get Custom Period', 'getCustomPeriodWithPrompt')
    .addSeparator()
    .addItem('Q1 2024', 'getQ1_2024')
    .addItem('Q2 2024', 'getQ2_2024')
    .addItem('Q3 2024', 'getQ3_2024')
    .addItem('Q4 2024', 'getQ4_2024')
    .addSeparator()
    .addItem('Q1 2025', 'getQ1_2025')
    .addItem('Q2 2025', 'getQ2_2025')
    .addItem('Q3 2025', 'getQ3_2025')
    .addItem('Q4 2025', 'getQ4_2025')
    .addSeparator()
    .addItem('📊 Compare Q1 (2024 vs 2025)', 'comparePeriods')
    .addItem('💾 Export Custom Period to Sheet', 'exportCustomPeriodPrompt')
    .addToUi();
}

/**
 * Export with prompt
 */
function exportCustomPeriodPrompt() {
  const ui = SpreadsheetApp.getUi();

  // Get start date
  const startResponse = ui.prompt(
    'Export Data',
    'Enter start date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (startResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  // Get end date
  const endResponse = ui.prompt(
    'Export Data',
    'Enter end date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (endResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const startDate = startResponse.getResponseText();
  const endDate = endResponse.getResponseText();

  exportCustomPeriodToSheet(startDate, endDate);
}