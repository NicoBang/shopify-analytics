// Test script til at verificere refund fix
// Kør dette i Google Apps Script efter SQL cleanup

function testRefundFix() {
  const CONFIG = {
    API_BASE: 'https://shopify-analytics-ptit8lz80-nicolais-projects-291e9559.vercel.app/api',
    API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc'
  };

  const ui = SpreadsheetApp.getUi();

  try {
    // Test data for 16. januar 2025
    console.log('📊 Tester artikelnummer 20204 for 16. januar 2025...');

    const url = `${CONFIG.API_BASE}/sku-raw?startDate=2025-01-16&endDate=2025-01-16&aggregateBy=artikelnummer&search=20204`;

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const result = JSON.parse(response.getContentText());

      if (result.aggregated && result.aggregated.length > 0) {
        const item = result.aggregated[0];

        const message = `Artikelnummer 20204 - 16. januar 2025:

🛍️ Total Quantity: ${item.totalQuantity} (skulle være 3)
↩️ Refunded: ${item.totalRefunded}
📊 Net Sold: ${item.totalQuantity - item.totalRefunded}
🏪 Shops: ${item.shopCount}
📦 Unique Orders: ${item.orderCount}`;

        ui.alert('✅ Test Resultat', message, ui.ButtonSet.OK);

        // Tjek også total for dagen
        console.log('📊 Tjekker total for 16. januar 2025...');
        const totalUrl = `${CONFIG.API_BASE}/sku-raw?startDate=2025-01-16&endDate=2025-01-16&limit=all`;

        const totalResponse = UrlFetchApp.fetch(totalUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CONFIG.API_KEY}`,
            'Content-Type': 'application/json'
          },
          muteHttpExceptions: true
        });

        if (totalResponse.getResponseCode() === 200) {
          const totalResult = JSON.parse(totalResponse.getContentText());

          const totalMessage = `Total for 16. januar 2025:

📊 Total Records: ${totalResult.summary.totalRecords}
📦 Total Quantity Sold: ${totalResult.summary.totalQuantitySold} (skulle være 377, ikke 736)
↩️ Total Refunded: ${totalResult.summary.totalQuantityRefunded}
🏪 Unique SKUs: ${totalResult.summary.uniqueSkus}`;

          ui.alert('📊 Total for Dagen', totalMessage, ui.ButtonSet.OK);
        }

      } else {
        ui.alert('⚠️', 'Ingen data fundet for artikelnummer 20204', ui.ButtonSet.OK);
      }

    } else {
      throw new Error(`API returned status ${response.getResponseCode()}`);
    }

  } catch (error) {
    ui.alert('❌ Error', 'Test fejlede: ' + error.message, ui.ButtonSet.OK);
  }
}

// Tilføj menu item
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Test Refund Fix')
    .addItem('Test Artikelnummer 20204', 'testRefundFix')
    .addToUi();
}