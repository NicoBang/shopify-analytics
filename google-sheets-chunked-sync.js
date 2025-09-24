// google-sheets-chunked-sync.js
// Google Apps Script for chunked data sync without timeouts

// =====================================================================
// CONFIGURATION
// =====================================================================
const CHUNKED_CONFIG = {
  API_BASE_URL: 'https://shopify-analytics-1iczubfpd-nicolais-projects-291e9559.vercel.app',
  API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',
  SHOPS: [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ],
  CHUNK_DAYS: 7,
  MAX_RETRIES: 3
};

// =====================================================================
// CHUNKED SYNC MANAGER
// =====================================================================

/**
 * Sync all data for Q1 2025 (January 1 - March 31)
 * Processes in small chunks to avoid timeouts
 */
function syncQ1_2025() {
  const startDate = '2025-01-01';
  const endDate = '2025-03-31';

  console.log(`🚀 Starting Q1 2025 sync (${startDate} to ${endDate})`);

  // Sync all shops
  CHUNKED_CONFIG.SHOPS.forEach(shop => {
    try {
      syncShopChunked(shop, startDate, endDate);
    } catch (error) {
      console.error(`❌ Failed to sync ${shop}:`, error.message);
    }
  });
}

/**
 * Sync all data for 2024 Q4 (for testing with historical data)
 */
function sync2024_Q4() {
  const startDate = '2024-09-01';
  const endDate = '2024-12-31';

  console.log(`🚀 Starting 2024 Q4 sync (${startDate} to ${endDate})`);

  CHUNKED_CONFIG.SHOPS.forEach(shop => {
    try {
      syncShopChunked(shop, startDate, endDate);
    } catch (error) {
      console.error(`❌ Failed to sync ${shop}:`, error.message);
    }
  });
}

/**
 * Sync a specific date range for all shops
 */
function syncDateRange(startDate, endDate) {
  console.log(`🚀 Starting sync for ${startDate} to ${endDate}`);

  CHUNKED_CONFIG.SHOPS.forEach(shop => {
    try {
      syncShopChunked(shop, startDate, endDate);
    } catch (error) {
      console.error(`❌ Failed to sync ${shop}:`, error.message);
    }
  });
}

/**
 * Process a shop in chunks
 */
function syncShopChunked(shop, startDate, endDate) {
  console.log(`📦 Processing ${shop} from ${startDate} to ${endDate}`);

  let chunkIndex = 0;
  let hasMore = true;
  let totalProcessed = 0;
  let totalSaved = 0;

  while (hasMore) {
    try {
      const url = `${CHUNKED_CONFIG.API_BASE_URL}/api/sync-chunked?shop=${shop}&startDate=${startDate}&endDate=${endDate}&chunkIndex=${chunkIndex}`;

      const response = UrlFetchApp.fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CHUNKED_CONFIG.API_KEY}`,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());

      if (!result.success) {
        console.error(`❌ Chunk ${chunkIndex} failed:`, result.error);
        break;
      }

      // Check if all chunks are processed
      if (result.message === 'All chunks processed') {
        console.log(`✅ ${shop} complete: ${totalProcessed} processed, ${totalSaved} saved`);
        hasMore = false;
        break;
      }

      // Update totals
      if (result.chunk) {
        totalProcessed += result.chunk.processed || 0;
        totalSaved += result.chunk.saved || 0;

        console.log(`  Chunk ${result.chunk.index + 1}/${result.chunk.total}: ${result.chunk.processed} processed, ${result.chunk.saved} saved (${result.progress})`);
      }

      // Check if there's a next chunk
      if (!result.nextChunk) {
        hasMore = false;
      } else {
        chunkIndex++;
      }

      // Small delay between chunks to avoid rate limiting
      Utilities.sleep(1000);

    } catch (error) {
      console.error(`❌ Error processing chunk ${chunkIndex}:`, error.message);

      // Retry logic
      if (chunkIndex < CHUNKED_CONFIG.MAX_RETRIES) {
        console.log(`🔄 Retrying chunk ${chunkIndex}...`);
        Utilities.sleep(5000);
      } else {
        break;
      }
    }
  }

  return { processed: totalProcessed, saved: totalSaved };
}

/**
 * Interactive sync with progress tracking
 */
function syncWithProgress() {
  const ui = SpreadsheetApp.getUi();

  // Get date range from user
  const startResponse = ui.prompt(
    'Sync Data',
    'Enter start date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (startResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const endResponse = ui.prompt(
    'Sync Data',
    'Enter end date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (endResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const startDate = startResponse.getResponseText();
  const endDate = endResponse.getResponseText();

  // Create progress sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let progressSheet = ss.getSheetByName('_SYNC_PROGRESS');
  if (!progressSheet) {
    progressSheet = ss.insertSheet('_SYNC_PROGRESS');
  }

  progressSheet.clear();
  progressSheet.getRange('A1:E1').setValues([['Shop', 'Status', 'Processed', 'Saved', 'Progress']]);
  progressSheet.getRange('A1:E1').setFontWeight('bold');

  // Process each shop
  CHUNKED_CONFIG.SHOPS.forEach((shop, index) => {
    const row = index + 2;
    progressSheet.getRange(row, 1).setValue(shop);
    progressSheet.getRange(row, 2).setValue('Processing...');
    SpreadsheetApp.flush();

    try {
      const result = syncShopChunked(shop, startDate, endDate);
      progressSheet.getRange(row, 2).setValue('✅ Complete');
      progressSheet.getRange(row, 3).setValue(result.processed);
      progressSheet.getRange(row, 4).setValue(result.saved);
      progressSheet.getRange(row, 5).setValue('100%');
    } catch (error) {
      progressSheet.getRange(row, 2).setValue('❌ Failed');
      progressSheet.getRange(row, 5).setValue(error.message);
    }

    SpreadsheetApp.flush();
  });

  ui.alert('Sync Complete', 'All shops have been processed. Check _SYNC_PROGRESS sheet for details.', ui.ButtonSet.OK);
}

/**
 * Check current data status in database
 */
function checkDataStatus() {
  const url = `${CHUNKED_CONFIG.API_BASE_URL}/api/sku-raw?startDate=2025-01-01&endDate=2025-03-31`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CHUNKED_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.success) {
      console.log('📊 Q1 2025 Data Status:');
      console.log(`  Total Records: ${result.summary.totalRecords}`);
      console.log(`  Total Quantity Sold: ${result.summary.totalQuantitySold}`);
      console.log(`  Total Revenue (DKK): ${result.summary.totalRevenue}`);
      console.log(`  Unique SKUs: ${result.summary.uniqueSkus}`);
      console.log(`  Unique Orders: ${result.summary.uniqueOrders}`);
      console.log(`  Unique Shops: ${result.summary.uniqueShops}`);

      // Create or update status sheet
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let statusSheet = ss.getSheetByName('_DATA_STATUS');
      if (!statusSheet) {
        statusSheet = ss.insertSheet('_DATA_STATUS');
      }

      statusSheet.clear();
      statusSheet.getRange('A1:B1').setValues([['Metric', 'Value']]);
      statusSheet.getRange('A1:B1').setFontWeight('bold');

      const statusData = [
        ['Period', 'Q1 2025 (Jan 1 - Mar 31)'],
        ['Total Records', result.summary.totalRecords],
        ['Total Quantity Sold', result.summary.totalQuantitySold],
        ['Total Revenue (DKK)', result.summary.totalRevenue],
        ['Unique SKUs', result.summary.uniqueSkus],
        ['Unique Orders', result.summary.uniqueOrders],
        ['Unique Shops', result.summary.uniqueShops],
        ['Last Updated', new Date().toLocaleString()]
      ];

      statusSheet.getRange(2, 1, statusData.length, 2).setValues(statusData);

      SpreadsheetApp.getUi().alert('Data Status', `Q1 2025: ${result.summary.totalQuantitySold} items sold across ${result.summary.uniqueShops} shops`, SpreadsheetApp.getUi().ButtonSet.OK);

    } else {
      console.error('❌ Failed to get data status:', result.error);
    }

  } catch (error) {
    console.error('❌ Error checking data status:', error.message);
  }
}

/**
 * Setup menu items
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Chunked Sync')
    .addItem('📊 Check Q1 2025 Status', 'checkDataStatus')
    .addSeparator()
    .addItem('🚀 Sync Q1 2025', 'syncQ1_2025')
    .addItem('📅 Sync 2024 Q4', 'sync2024_Q4')
    .addItem('🎯 Sync Custom Range', 'syncWithProgress')
    .addSeparator()
    .addItem('📈 Refresh Analytics', 'generateStyleColorAnalytics')
    .addToUi();
}

/**
 * Test function to verify connectivity
 */
function testChunkedSync() {
  const shop = 'pompdelux-da.myshopify.com';
  const startDate = '2025-03-20';
  const endDate = '2025-03-31';

  console.log(`🧪 Testing chunked sync for ${shop}`);
  console.log(`  Date range: ${startDate} to ${endDate}`);

  const url = `${CHUNKED_CONFIG.API_BASE_URL}/api/sync-chunked?shop=${shop}&startDate=${startDate}&endDate=${endDate}&chunkIndex=0`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CHUNKED_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    console.log('✅ Test successful:', result);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}