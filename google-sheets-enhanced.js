// Google Apps Script - Enhanced Shopify Analytics Integration
// Erstatter det gamle 15.000+ linje system med moderne APIs

// Configuration
const CONFIG = {
  API_BASE: 'shopify-analytics-3na9ioty8-nicolais-projects-291e9559.vercel.app/api',
  API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',
  SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),

  // Ark navne
  SHEETS: {
    DASHBOARD: 'Dashboard',
    ORDERS: 'Orders',
    SKU_ANALYTICS: 'SKU_Analytics',
    INVENTORY: 'Inventory',
    FULFILLMENTS: 'Fulfillments',
    METADATA: 'Metadata',
    STYLE_ANALYTICS: 'Style_Analytics'
  },

  // Butikker
  SHOPS: [
    'pompdelux-da.myshopify.com',
    'pompdelux-de.myshopify.com',
    'pompdelux-nl.myshopify.com',
    'pompdelux-int.myshopify.com',
    'pompdelux-chf.myshopify.com'
  ]
};

/**
 * MENU FUNKTIONER - Tilgængelige fra Google Sheets menu
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Shopify Analytics')
    .addItem('Update Dashboard (30 days)', 'updateDashboard')
    .addItem('Update SKU Analytics', 'updateSkuAnalytics')
    .addItem('Update Inventory', 'updateInventory')
    .addItem('Update Fulfillments', 'updateFulfillments')
    .addItem('Generate Delivery Report', 'generateDeliveryReportFromAPI')
    .addSeparator()
    .addItem('Sync All Shops (Orders)', 'syncAllShops')
    .addItem('Sync All Shops (SKUs)', 'syncAllShopsSku')
    .addItem('Sync All Shops (Inventory)', 'syncAllShopsInventory')
    .addSeparator()
    .addItem('Style Analytics (Colors)', 'generateStyleColorAnalytics')
    .addItem('Style Analytics (Products)', 'generateStyleProductAnalytics')
    .addItem('Financial Analytics', 'generateFinancialAnalytics')
    .addSeparator()
    .addItem('Test Connection', 'testConnection')
    .addItem('🔍 Test Q1 2025 Pagination', 'testQ1DataPagination')
    .addItem('Create Daily Trigger', 'createDailyTrigger')
    .addToUi();
}

/**
 * HOVEDFUNKTIONER
 */

/**
 * Opdater dashboard med de sidste 30 dages data
 */
function updateDashboard() {
  try {
    console.log('🚀 Starter dashboard opdatering...');

    // Læs datoer fra Dashboard arket (B1/B2). Fallback: sidste 30 dage
    const { startDate, endDate } = getDashboardSelectedDates_();

    // Hent ordrer oprettet i perioden + retur-ordrer dateret efter refund_date
    const url = `${CONFIG.API_BASE}/analytics`;
    const payload = {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      type: 'orders',
      includeReturns: true
    };
    const res = makeApiRequest(url, payload);

    const ordersRows = Array.isArray(res?.data) ? res.data : [];
    const returnRows = Array.isArray(res?.returns) ? res.returns : [];

    renderDashboard_(ordersRows, returnRows, startDate, endDate);
    console.log(`✅ Dashboard opdateret (orders: ${ordersRows.length}, returns: ${returnRows.length})`);

  } catch (error) {
    console.error('💥 Fejl i updateDashboard:', error);
    throw error;
  }
}

// Render Dashboard identisk med det gamle GAS-setup
function renderDashboard_(orderRows, returnRows, startDate, endDate) {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.DASHBOARD);

  // Sæt dato inputs i toppen (A1/A2) som i det gamle setup
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  // Bevar brugerens indtastede datoer i B1/B2 uændret; kun format
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

  // Ryd alt under række 4 (behold eventuelle brugerfelter over det)
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  // Headers som i det gamle Dashboard
  const headers = [
    'Shop','Bruttoomsætning','Nettoomsætning',
    'Antal stk Brutto','Antal stk Netto','Antal Ordrer',
    'Gnst ordreværdi','Basket size','Gns. stykpris',
    'Retur % i stk','Retur % i kr','Retur % i antal o',
    'Fragt indtægt ex','% af oms','Rabat ex moms','Cancelled stk'
  ];
  sheet.getRange('A4:P4').setValues([headers]).setFontWeight('bold').setBackground('#E3F2FD');

  // Indekser for order rows (som fra /api/analytics?type=orders)
  const IDX = {
    SHOP:0, ORDER_ID:1, CREATED_AT:2, COUNTRY:3, DISCOUNTED_TOTAL:4,
    TAX:5, SHIPPING:6, ITEM_COUNT:7, REFUNDED_AMOUNT:8, REFUNDED_QTY:9,
    REFUND_DATE:10, TOTAL_DISCOUNTS_EX_TAX:11, CANCELLED_QTY:12,
    SALE_DISCOUNT_TOTAL:13, COMBINED_DISCOUNT_TOTAL:14
  };

  // Init pr. shop
  const shops = extractShopsFromOrders_(orderRows);
  const shopMap = {};
  const skuStats = {};
  shops.forEach(s => {
    shopMap[s] = { gross:0, net:0, orders:new Set(), shipping:0, refundedAmount:0, refundOrders:new Set(), totalDiscounts:0 };
    skuStats[s] = { qty:0, qtyNet:0, refundedQty:0, cancelledQty:0 };
  });

  // Ordrer oprettet i perioden
  orderRows.forEach(row => {
    if (!row || row.length < 15) return;
    const shop = row[IDX.SHOP];
    if (!shopMap[shop]) return;

    const discountedTotal = toNum_(row[IDX.DISCOUNTED_TOTAL]);
    const tax = toNum_(row[IDX.TAX]);
    const shipping = toNum_(row[IDX.SHIPPING]);
    const shippingTax = shipping * 0.25; // 25% moms på fragt
    const productTax = tax - shippingTax; // Moms kun på produkter
    const brutto = discountedTotal - productTax;

    shopMap[shop].gross += brutto;
    shopMap[shop].net += brutto;
    shopMap[shop].shipping += shipping;
    shopMap[shop].totalDiscounts += toNum_(row[IDX.COMBINED_DISCOUNT_TOTAL]);
    shopMap[shop].orders.add(row[IDX.ORDER_ID]);

    const cancelledQty = toNum_(row[IDX.CANCELLED_QTY]);
    const itemCount = toNum_(row[IDX.ITEM_COUNT]);
    // Brutto antal skal ekskludere annulleringer
    const bruttoQty = Math.max(0, itemCount - cancelledQty);
    skuStats[shop].qty += bruttoQty;
    // Netto starter fra brutto (allerede uden annulleringer) og reduceres senere af retur
    skuStats[shop].qtyNet += bruttoQty;
    skuStats[shop].cancelledQty += cancelledQty;

    // Træk annulleringer fra nettoomsætning proportionalt med enhedsprisen ex moms
    if (itemCount > 0 && cancelledQty > 0) {
      const perUnitExTax = brutto / itemCount;
      const cancelValueExTax = perUnitExTax * cancelledQty;
      // Træk fra både brutto (B) og netto (C)
      shopMap[shop].gross -= cancelValueExTax;
      shopMap[shop].net -= cancelValueExTax;
    }
  });

  // Returer dateret på refund_date i perioden
  returnRows.forEach(row => {
    if (!row || row.length < 15) return;
    const shop = row[IDX.SHOP];
    if (!shopMap[shop]) return;

    const refundedAmount = toNum_(row[IDX.REFUNDED_AMOUNT]);
    const refundedQty = toNum_(row[IDX.REFUNDED_QTY]);
    const refundDate = row[IDX.REFUND_DATE];
    if (!refundDate) return;

    shopMap[shop].net -= refundedAmount;
    shopMap[shop].refundedAmount += refundedAmount;
    if (refundedQty > 0) {
      const orderId = row[IDX.ORDER_ID] || '';
      shopMap[shop].refundOrders.add(orderId);
    }
    skuStats[shop].refundedQty += refundedQty;
    skuStats[shop].qtyNet -= refundedQty;
  });

  // Byg rækker
  const rows = [];
  const totals = { brutto:0, netto:0, stkBrutto:0, stkNetto:0, orders:0, fragt:0, returStk:0, returKr:0, returOrdre:0, rabat:0, cancelled:0 };

  shops.forEach(shop => {
    const o = shopMap[shop], s = skuStats[shop];
    const orders = o.orders.size;
    const brutto = o.gross, netto = o.net, fragt = o.shipping;
    const stkBrutto = s.qty, stkNetto = s.qtyNet;
    const stkPris = stkNetto > 0 ? netto / stkNetto : 0;
    const ordreværdi = orders > 0 ? netto / orders : 0;
    const basketSize = orders > 0 ? stkNetto / orders : 0;
    const returStkPct = stkBrutto > 0 ? s.refundedQty / stkBrutto : 0;
    const returKrPct = brutto > 0 ? o.refundedAmount / brutto : 0;
    const returOrdrePct = orders > 0 ? o.refundOrders.size / orders : 0;
    const fragtPct = netto > 0 ? fragt / netto : 0;

    rows.push([
      shopLabel_(shop),
      round2_(brutto),
      round2_(netto),
      stkBrutto,
      stkNetto,
      orders,
      round2_(ordreværdi),
      toFixed1_(basketSize),
      round2_(stkPris),
      pctStr_(returStkPct),
      pctStr_(returKrPct),
      pctStr_(returOrdrePct),
      round2_(fragt),
      toFixed2_(fragtPct * 100),
      round2_(o.totalDiscounts),
      s.cancelledQty
    ]);

    totals.brutto += brutto; totals.netto += netto; totals.stkBrutto += stkBrutto; totals.stkNetto += stkNetto;
    totals.orders += orders; totals.fragt += fragt; totals.returStk += s.refundedQty; totals.returKr += o.refundedAmount;
    totals.returOrdre += o.refundOrders.size; totals.rabat += o.totalDiscounts; totals.cancelled += s.cancelledQty;
  });

  // Total række
  rows.push([
    'I alt',
    round2_(totals.brutto),
    round2_(totals.netto),
    totals.stkBrutto,
    totals.stkNetto,
    totals.orders,
    round2_(totals.orders > 0 ? totals.netto / totals.orders : 0),
    totals.orders > 0 ? toFixed1_(totals.stkNetto / totals.orders) : '0',
    round2_(totals.stkNetto > 0 ? totals.netto / totals.stkNetto : 0),
    pctStr_(totals.stkBrutto > 0 ? (totals.returStk / totals.stkBrutto) : 0),
    pctStr_(totals.brutto > 0 ? (totals.returKr / totals.brutto) : 0),
    pctStr_(totals.orders > 0 ? (totals.returOrdre / totals.orders) : 0),
    round2_(totals.fragt),
    toFixed2_(totals.netto > 0 ? (totals.fragt / totals.netto * 100) : 0),
    round2_(totals.rabat),
    totals.cancelled
  ]);

  if (rows.length > 0) {
    sheet.getRange(5, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(5 + rows.length - 1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#F0F8FF');
    sheet.autoResizeColumns(1, rows[0].length);
  }
}

// Hjælpere til Dashboard
function extractShopsFromOrders_(rows) {
  const s = new Set();
  rows.forEach(r => { if (r && r.length > 0 && r[0]) s.add(r[0]); });
  return Array.from(s).sort();
}

function shopLabel_(domain) {
  const map = {
    'pompdelux-da.myshopify.com':'DA',
    'pompdelux-de.myshopify.com':'DE',
    'pompdelux-nl.myshopify.com':'NL',
    'pompdelux-int.myshopify.com':'INT',
    'pompdelux-chf.myshopify.com':'CHF'
  };
  return map[domain] || domain;
}

function toNum_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function round2_(v) { return Math.round((v || 0) * 100) / 100; }
function toFixed1_(v) { return (v || 0).toFixed(1); }
function toFixed2_(v) { return (v || 0).toFixed(2); }
function pctStr_(v) { return (Math.round((v || 0) * 10000) / 100).toFixed(2) + '%'; }

// Læs brugerens valgte datoer fra Dashboard arket (B1/B2). Fallback: sidste 30 dage
function getDashboardSelectedDates_() {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.DASHBOARD);

  // Sørg for labels findes
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');

  let startVal, endVal;
  try {
    startVal = sheet.getRange('B1').getValue();
    endVal = sheet.getRange('B2').getValue();
  } catch (e) {
    // ignore
  }

  if (startVal instanceof Date && endVal instanceof Date && !isNaN(startVal) && !isNaN(endVal)) {
    // Arbejd direkte på kopier uden at skrive tilbage til celler
    const s = new Date(startVal.getTime());
    const e = new Date(endVal.getTime());
    // Fortolk datoer i lokal tidszone nøjagtigt som indtastet
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }

  // Fallback til sidste 30 dage og skriv dem i cellerne
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  // Skriv kun fallback-datoer når cellerne er tomme/ugyldige
  sheet.getRange('B1').setValue(startDate);
  sheet.getRange('B2').setValue(endDate);
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');
  return { startDate, endDate };
}

/**
 * Opdater SKU analytics - erstatter den gamle SKU_CACHE
 */
function updateSkuAnalytics() {
  try {
    console.log('🏷️ Starter SKU analytics opdatering...');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90); // Sidste 90 dage for SKU analyse

    const data = fetchSkuData(startDate, endDate, 'analytics');

    if (data.success && data.count > 0) {
      // SKU analytics har anden struktur end rådata
      const headers = ['SKU', 'Product Title', 'Total Quantity', 'Total Revenue', 'Order Count', 'Avg Price', 'Refund Rate', 'Countries', 'First Sale', 'Last Sale'];
      const formattedData = data.data.map(item => [
        item.sku,
        item.product_title,
        item.total_quantity,
        item.total_revenue,
        item.order_count,
        parseFloat(item.avg_price),
        parseFloat(item.refund_rate),
        item.countries.join(', '),
        item.first_sale,
        item.last_sale
      ]);

      updateSheet(CONFIG.SHEETS.SKU_ANALYTICS, headers, formattedData);
      console.log(`✅ SKU Analytics opdateret med ${data.count} SKUs`);
    } else {
      console.log('⚠️ Ingen SKU data modtaget');
    }

  } catch (error) {
    console.error('💥 Fejl i updateSkuAnalytics:', error);
    throw error;
  }
}

/**
 * Opdater inventory data
 */
function updateInventory() {
  try {
    console.log('📦 Starter inventory opdatering...');

    const data = fetchInventoryData('list', { includeMetadata: true });

    if (data.success && data.count > 0) {
      // Format inventory data med metadata
      const headers = ['SKU', 'Quantity', 'Product Title', 'Status', 'Program', 'Color', 'Season', 'Last Updated'];
      const formattedData = data.data.map(item => [
        item.sku,
        item.quantity,
        item.product_metadata?.product_title || '',
        item.product_metadata?.status || '',
        item.product_metadata?.program || '',
        item.product_metadata?.farve || '',
        item.product_metadata?.season || '',
        item.last_updated
      ]);

      updateSheet(CONFIG.SHEETS.INVENTORY, headers, formattedData);
      console.log(`✅ Inventory opdateret med ${data.count} items`);
    } else {
      console.log('⚠️ Ingen inventory data modtaget');
    }

  } catch (error) {
    console.error('💥 Fejl i updateInventory:', error);
    throw error;
  }
}

/**
 * Opdater fulfillment data
 */
function updateFulfillments() {
  try {
    console.log('🚚 Starter fulfillments opdatering...');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const data = fetchFulfillmentData(startDate, endDate, 'list');

    if (data.success && data.count > 0) {
      updateSheet(CONFIG.SHEETS.FULFILLMENTS, data.headers, data.data);
      console.log(`✅ Fulfillments opdateret med ${data.count} forsendelser`);
    } else {
      console.log('⚠️ Ingen fulfillment data modtaget');
    }

  } catch (error) {
    console.error('💥 Fejl i updateFulfillments:', error);
    throw error;
  }
}

/**
 * AVANCEREDE ANALYTICS FUNKTIONER
 */

/**
 * Style Color Analytics - erstatter generateStyleColorAnalytics()
 * Læser datoer fra celler A1 (startdato) og B1 (slutdato) i Color_Analytics sheet
 * Data placeres fra række 4 for at beskytte dato-inputs
 */
function generateStyleColorAnalytics() {
  try {
    console.log('🎨 Starter color analytics...');

    // Prøv at læse datoer fra Color_Analytics sheet
    let startDate, endDate;

    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Color_Analytics');
      if (sheet) {
        const startDateCell = sheet.getRange('A1').getValue();
        const endDateCell = sheet.getRange('B1').getValue();

        // Hvis begge celler indeholder gyldige datoer, brug dem
        if (startDateCell instanceof Date && endDateCell instanceof Date) {
          startDate = new Date(startDateCell);
          endDate = new Date(endDateCell);

          // Hvis samme dag valgt, sæt endDate til slutningen af dagen
          if (startDate.toDateString() === endDate.toDateString()) {
            endDate.setHours(23, 59, 59, 999);
            console.log(`📅 Samme dag valgt - analyserer hele dagen: ${formatDate(startDate)}`);
          } else {
            console.log(`📅 Bruger brugerdefinerede datoer: ${formatDate(startDate)} til ${formatDate(endDate)}`);
          }
        } else {
          // Opret standard header med dato-eksempler hvis sheet eksisterer men celler er tomme
          if (!startDateCell || !endDateCell) {
            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 90);

            // Kun sæt datoer hvis cellerne er helt tomme
            if (!startDateCell) sheet.getRange('A1').setValue(defaultStart);
            if (!endDateCell) sheet.getRange('B1').setValue(today);
            sheet.getRange('C1').setValue('← Rediger disse datoer for at vælge periode');

            // Opsæt header i række 3
            sheet.getRange('A3').setValue('Startdato');
            sheet.getRange('B3').setValue('Slutdato');
            sheet.getRange('C3').setValue('Vejledning');

            startDate = startDateCell || defaultStart;
            endDate = endDateCell || today;
            console.log(`📅 Oprettede standard datoer. Rediger A1 og B1 for at vælge periode.`);
          }
        }
      }
    } catch (sheetError) {
      console.log('ℹ️ Color_Analytics sheet ikke fundet eller fejl ved læsning af datoer');
    }

    // Fallback til standard 90-dages periode hvis ingen gyldige datoer blev fundet
    if (!startDate || !endDate) {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      console.log(`📅 Bruger standard 90-dages periode: ${formatDate(startDate)} til ${formatDate(endDate)}`);
    }

    const data = fetchMetadataData('style', {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      groupBy: 'farve'
    });

    console.log(`📊 API Response: success=${data.success}, count=${data.count}, data length=${data.data ? data.data.length : 'null'}`);

    if (data.success && data.count > 0) {
      // Back to 20-column structure (Cancelled er nu trukket fra Solgt direkte i API)
      const headers = [
        'Program', 'Produkt', 'Farve', 'Artikelnummer', 'Sæson', 'Køn',
        'Beregnet købt', 'Solgt', 'Retur', 'Lager', 'Varemodtaget', 'Difference',
        'Solgt % af købt', 'Retur % af solgt', 'Kostpris', 'DB', 'Omsætning kr',
        'Status', 'Tags', 'Vejl. Pris'
      ];
      const formattedData = data.data.map(item => [
        item.program || '',           // Program
        item.produkt || '',           // Produkt
        item.farve || '',             // Farve
        item.artikelnummer || '',     // Artikelnummer
        item.season || '',            // Sæson
        convertGenderToDanish(item.gender), // Køn
        item.beregnetKøbt || 0,       // Beregnet købt
        item.solgt || 0,              // Solgt (inkl. cancelled trukket fra)
        item.retur || 0,              // Retur
        item.lager || 0,              // Lager
        item.varemodtaget || 0,       // Varemodtaget
        item.difference || 0,         // Difference
        item.solgtPct || 0,           // Solgt % af købt
        item.returPct || 0,           // Retur % af solgt
        item.kostpris || 0,           // Kostpris
        item.db || 0,                 // DB (dækningsgrad)
        item.omsætning || 0,          // Omsætning kr
        item.status || '',            // Status
        item.tags || '',              // Tags
        item.vejlPris || 0            // Vejl. Pris
      ]);

      // Opdater sheet med data fra række 4
      updateSheetWithOffset('Color_Analytics', headers, formattedData, 4);
      console.log(`✅ Color Analytics opdateret med ${data.count} farver for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
    } else {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
      console.log(`📊 API Response details: success=${data.success}, count=${data.count}`);

      // Vis besked til brugeren hvis ingen data
      if (data.success && data.count === 0) {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Color_Analytics');
        if (sheet) {
          // Clear data area but keep headers
          if (sheet.getLastRow() >= 4) {
            const lastRow = sheet.getLastRow();
            const lastCol = sheet.getLastColumn();
            if (lastRow >= 4 && lastCol > 0) {
              sheet.getRange(4, 1, lastRow - 4 + 1, lastCol).clear();
            }
          }

          // Add "No data" message
          sheet.getRange('A4').setValue(`Ingen data for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
          sheet.getRange('A4').setFontStyle('italic').setFontColor('#666666');
        }
      }
    }

  } catch (error) {
    console.error('💥 Fejl i generateStyleColorAnalytics:', error);
    throw error;
  }
}

/**
 * Style Product Analytics
 */
function generateStyleProductAnalytics() {
  try {
    console.log('🏗️ Starter product analytics...');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const data = fetchMetadataData('style', {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      groupBy: 'produkt'
    });

    if (data.success && data.count > 0) {
      const headers = ['Product', 'Total Quantity', 'Total Revenue', 'Unique SKUs', 'Avg Price', 'Refund Rate'];
      const formattedData = data.data.map(item => [
        item.groupKey,
        item.totalQuantity,
        item.totalRevenue,
        item.uniqueSkus,
        parseFloat(item.avgPrice),
        parseFloat(item.refundRate)
      ]);

      updateSheet('Product_Analytics', headers, formattedData);
      console.log(`✅ Product Analytics opdateret med ${data.count} produkter`);
    }

  } catch (error) {
    console.error('💥 Fejl i generateStyleProductAnalytics:', error);
    throw error;
  }
}

/**
 * Financial Analytics - kombinerer orders med inventory
 */
function generateFinancialAnalytics() {
  try {
    console.log('💰 Starter financial analytics...');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    // Hent både order og inventory data
    const orderData = fetchAnalyticsData(startDate, endDate, 'raw');
    const inventoryData = fetchInventoryData('analytics');

    if (orderData.success && inventoryData.success) {
      // Kombiner data og beregn financial metrics
      const financialData = combineFinancialData(orderData.data, inventoryData.data);

      const headers = ['Metric', 'Value', 'Period'];
      updateSheet('Financial_Analytics', headers, financialData);
      console.log(`✅ Financial Analytics opdateret`);
    }

  } catch (error) {
    console.error('💥 Fejl i generateFinancialAnalytics:', error);
    throw error;
  }
}

/**
 * SYNC FUNKTIONER
 */

/**
 * Synkroniser alle butikker (ordrer)
 */
function syncAllShops() {
  try {
    console.log('🔄 Starter sync af alle butikker...');

    CONFIG.SHOPS.forEach(shop => {
      console.log(`📊 Syncer ${shop}...`);
      const result = syncShop(shop, 'orders', 7);

      if (result.success) {
        console.log(`✅ ${shop}: ${result.recordsSynced} ordrer synced`);
      } else {
        console.log(`❌ ${shop}: Fejl i sync`);
      }

      Utilities.sleep(1000); // 1 sekund pause mellem shops
    });

    console.log('✅ Alle butikker synced');

  } catch (error) {
    console.error('💥 Fejl i syncAllShops:', error);
    throw error;
  }
}

/**
 * Synkroniser alle butikker (SKUs)
 */
function syncAllShopsSku() {
  try {
    console.log('🏷️ Starter SKU sync af alle butikker...');

    CONFIG.SHOPS.forEach(shop => {
      console.log(`🏷️ Syncer SKUs fra ${shop}...`);
      const result = syncShop(shop, 'skus', 7);

      if (result.success) {
        console.log(`✅ ${shop}: ${result.recordsSynced} SKUs synced`);
      } else {
        console.log(`❌ ${shop}: Fejl i SKU sync`);
      }

      Utilities.sleep(1000);
    });

    console.log('✅ Alle SKUs synced');

  } catch (error) {
    console.error('💥 Fejl i syncAllShopsSku:', error);
    throw error;
  }
}

/**
 * Synkroniser alle butikker (inventory)
 */
function syncAllShopsInventory() {
  try {
    console.log('📦 Starter inventory sync af alle butikker...');

    CONFIG.SHOPS.forEach(shop => {
      console.log(`📦 Syncer inventory fra ${shop}...`);
      const result = syncShop(shop, 'inventory');

      if (result.success) {
        console.log(`✅ ${shop}: ${result.recordsSynced} items synced`);
      } else {
        console.log(`❌ ${shop}: Fejl i inventory sync`);
      }

      Utilities.sleep(1000);
    });

    console.log('✅ All inventory synced');

  } catch (error) {
    console.error('💥 Fejl i syncAllShopsInventory:', error);
    throw error;
  }
}

/**
 * API HJÆLPEFUNKTIONER
 */

/**
 * Hent analytics data
 */
function fetchAnalyticsData(startDate, endDate, type = 'dashboard', shop = null) {
  const url = `${CONFIG.API_BASE}/analytics`;
  const payload = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    type: type,
    shop: shop
  };

  return makeApiRequest(url, payload);
}

/**
 * Hent SKU data
 */
function fetchSkuData(startDate, endDate, type = 'list', options = {}) {
  const url = `${CONFIG.API_BASE}/sku-cache`;
  const payload = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    type: type,
    ...options
  };

  return makeApiRequest(url, payload);
}

/**
 * Hent inventory data
 */
function fetchInventoryData(type = 'list', options = {}) {
  const url = `${CONFIG.API_BASE}/inventory`;
  const payload = {
    type: type,
    ...options
  };

  return makeApiRequest(url, payload);
}

/**
 * Hent fulfillment data
 */
function fetchFulfillmentData(startDate, endDate, type = 'list', options = {}) {
  const url = `${CONFIG.API_BASE}/fulfillments`;
  const payload = {
    startDate: formatDateWithTime(startDate, false),
    endDate: formatDateWithTime(endDate, true),
    type: type,
    ...options
  };

  return makeApiRequest(url, payload);
}

/**
 * Hent metadata data
 */
function fetchMetadataData(type = 'list', options = {}) {
  const url = `${CONFIG.API_BASE}/metadata`;
  const payload = {
    type: type,
    ...options
  };

  return makeApiRequest(url, payload);
}

/**
 * Sync en butik
 */
function syncShop(shop, type = 'orders', days = 7) {
  const url = `${CONFIG.API_BASE}/sync-shop`;
  const payload = {
    shop: shop,
    type: type,
    days: days
  };

  return makeApiRequest(url, payload);
}

/**
 * Lav API request
 */
function makeApiRequest(url, params = {}) {
  try {
    // Byg URL med query parameters
    const queryParams = Object.entries(params)
      .filter(([_, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');

    const fullUrl = queryParams ? `${url}?${queryParams}` : url;

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.API_KEY}`
      }
    };

    console.log(`🔗 API Request: ${fullUrl}`);
    const response = UrlFetchApp.fetch(fullUrl, options);
    const data = JSON.parse(response.getContentText());

    if (data.error) {
      throw new Error(data.error);
    }

    return data;

  } catch (error) {
    console.error(`💥 API request fejl: ${error.message}`);
    throw error;
  }
}

/**
 * UTILITY FUNKTIONER
 */

/**
 * Konverter kønsangivelser til dansk
 */
function convertGenderToDanish(genderValue) {
  if (!genderValue) return '';

  // Fjern eventuelle brackets og split på komma
  const cleanValue = genderValue.replace(/[\[\]]/g, '');
  const genders = cleanValue.split(',').map(g => g.trim());

  // Hvis der er flere køn eller Unisex er med, returner Unisex
  if (genders.length > 1 || genders.includes('Unisex')) {
    return 'Unisex';
  }

  // Konverter enkelte køn til dansk
  switch (genders[0]) {
    case 'Girl':
      return 'Pige';
    case 'Boy':
      return 'Dreng';
    case 'Unisex':
      return 'Unisex';
    default:
      return genders[0]; // Returner original hvis ikke genkendt
  }
}

/**
 * Opdater et Google Sheet
 */
function updateSheet(sheetName, headers, data) {
  try {
    const sheet = getOrCreateSheet(sheetName);

    // Clear existing data
    sheet.clear();

    // Add headers
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    // Add data
    if (data && data.length > 0) {
      const startRow = headers ? 2 : 1;
      sheet.getRange(startRow, 1, data.length, data[0].length).setValues(data);
    }

    // Auto-resize columns
    sheet.autoResizeColumns(1, headers ? headers.length : data[0].length);

  } catch (error) {
    console.error(`💥 Fejl i updateSheet for ${sheetName}:`, error);
    throw error;
  }
}

/**
 * Opdater sheet med data fra en bestemt række (beskytter input-celler)
 */
function updateSheetWithOffset(sheetName, headers, data, startRow = 4) {
  try {
    const sheet = getOrCreateSheet(sheetName);

    // Clear kun data-området, ikke input-cellerne
    if (sheet.getLastRow() >= startRow) {
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow >= startRow && lastCol > 0) {
        sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).clear();
      }
    }

    // Add headers fra den angivne række
    if (headers && headers.length > 0) {
      sheet.getRange(startRow, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(startRow, 1, 1, headers.length).setFontWeight('bold');
    }

    // Add data lige under headers
    if (data && data.length > 0) {
      const dataStartRow = headers ? startRow + 1 : startRow;
      sheet.getRange(dataStartRow, 1, data.length, data[0].length).setValues(data);
    }

    // Auto-resize columns
    sheet.autoResizeColumns(1, headers ? headers.length : data[0].length);

  } catch (error) {
    console.error(`💥 Fejl i updateSheetWithOffset for ${sheetName}:`, error);
    throw error;
  }
}

/**
 * Hent eller opret et sheet
 */
function getOrCreateSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  return sheet;
}

/**
 * Format dato til API
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Formater start/slut dato med korrekt tid for API
 */
function formatDateWithTime(date, isEndDate = false) {
  if (isEndDate) {
    // For slutdato: sæt til slutningen af dagen
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return Utilities.formatDate(endOfDay, Session.getScriptTimeZone(), 'yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
  } else {
    // For startdato: sæt til starten af dagen
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return Utilities.formatDate(startOfDay, Session.getScriptTimeZone(), 'yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
  }
}

/**
 * Kombiner financial data
 */
function combineFinancialData(orderData, inventoryData) {
  const metrics = [];

  // Beregn grundlæggende metrics
  const totalRevenue = orderData.reduce((sum, order) => sum + (order[4] || 0), 0); // discounted_total
  const totalOrders = orderData.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const totalInventoryValue = inventoryData.summary?.totalValue || 0;
  const totalInventoryItems = inventoryData.summary?.totalQuantity || 0;

  metrics.push(['Total Revenue (DKK)', totalRevenue.toFixed(2), '90 days']);
  metrics.push(['Total Orders', totalOrders, '90 days']);
  metrics.push(['Avg Order Value (DKK)', avgOrderValue.toFixed(2), '90 days']);
  metrics.push(['Inventory Value (DKK)', totalInventoryValue.toFixed(2), 'Current']);
  metrics.push(['Inventory Items', totalInventoryItems, 'Current']);

  return metrics;
}

/**
 * Test forbindelse til API
 */
function testConnection() {
  try {
    console.log('🔍 Tester forbindelse til API...');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);

    const data = fetchAnalyticsData(startDate, endDate, 'raw');

    if (data.success) {
      console.log(`✅ Forbindelse OK: ${data.count} records fundet`);
      SpreadsheetApp.getUi().alert('Forbindelse OK', `API forbindelse vellykket. ${data.count} records fundet.`, SpreadsheetApp.getUi().ButtonSet.OK);
    } else {
      throw new Error('API returnerede fejl');
    }

  } catch (error) {
    console.error(`💥 Forbindelsesfejl: ${error.message}`);
    SpreadsheetApp.getUi().alert('Forbindelsesfejl', `Kunne ikke forbinde til API: ${error.message}`, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Test SKU data pagination for Q1 2025
 * This function verifies that the pagination fix is working correctly
 */
function testQ1DataPagination() {
  console.log('🔍 Testing Q1 2025 data pagination...');

  const ui = SpreadsheetApp.getUi();

  try {
    // Test SKU raw endpoint with the correct API URL
    const skuUrl = `${CONFIG.API_BASE}/sku-raw?startDate=2025-01-01&endDate=2025-03-31&limit=all`;

    console.log('📦 Fetching SKU data from:', skuUrl);

    const skuResponse = UrlFetchApp.fetch(skuUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    if (skuResponse.getResponseCode() === 200) {
      const skuResult = JSON.parse(skuResponse.getContentText());

      const message = `Q1 2025 Data Summary:

✅ Total SKU Records: ${skuResult.summary.totalRecords}
📦 Total Quantity Sold: ${skuResult.summary.totalQuantitySold}
↩️ Total Refunded: ${skuResult.summary.totalQuantityRefunded}
📊 Net Quantity Sold: ${skuResult.summary.netQuantitySold}
💰 Total Revenue (DKK): ${skuResult.summary.totalRevenue}
🏷️ Unique SKUs: ${skuResult.summary.uniqueSkus}
📋 Unique Orders: ${skuResult.summary.uniqueOrders}
🏪 Unique Shops: ${skuResult.summary.uniqueShops}

Note: This shows ALL shops. Your specific filtering (36,800) may be for certain shops only.
Current API URL: ${CONFIG.API_BASE}`;

      console.log('✅ Pagination test successful!');
      console.log(message);

      ui.alert('Q1 2025 Pagination Test', message, ui.ButtonSet.OK);

      // Also update menu to show this test function
      return skuResult.summary;
    } else {
      throw new Error(`SKU API returned status ${skuResponse.getResponseCode()}`);
    }
  } catch (error) {
    console.error('❌ Pagination test failed:', error);
    ui.alert(
      'Pagination Test Failed',
      'Error: ' + error.message + '\n\nCurrent API URL: ' + CONFIG.API_BASE,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Opret daglig trigger
 */
function createDailyTrigger() {
  try {
    // Slet eksisterende triggers
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'updateDashboard') {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    // Opret ny trigger (kl. 08:00 hver dag)
    ScriptApp.newTrigger('updateDashboard')
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .create();

    console.log('✅ Daglig trigger oprettet (kl. 08:00)');
    SpreadsheetApp.getUi().alert('Trigger oprettet', 'Daglig opdatering vil køre kl. 08:00 hver dag.', SpreadsheetApp.getUi().ButtonSet.OK);

  } catch (error) {
    console.error(`💥 Fejl i createDailyTrigger: ${error.message}`);
    SpreadsheetApp.getUi().alert('Trigger fejl', `Kunne ikke oprette trigger: ${error.message}`, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * DELIVERY REPORT (ny version) – genskaber DeliveryReport.gs via API
 */
function generateDeliveryReportFromAPI() {
  try {
    const sheet = getOrCreateSheet('Delivery Report');

    // Smart date selector
    setupDeliveryDateSelector_(sheet);
    const { startDate, endDate } = getDeliverySelectedDates_(sheet);

    const API_BASE_URL = CONFIG.API_BASE;

    // 1) Fulfillments i perioden (dateret på fulfillment.date)
    const fulfillments = makeApiRequest(
      `${API_BASE_URL}/fulfillments`,
      {
        startDate: formatDateWithTime(startDate, false),
        endDate: formatDateWithTime(endDate, true),
        type: 'list'
      }
    );

    // 2) Orders returns i perioden (by refundDate)
    const ordersRes = makeApiRequest(
      `${API_BASE_URL}/analytics`,
      {
        startDate: formatDateWithTime(startDate, false),
        endDate: formatDateWithTime(endDate, true),
        type: 'orders',
        includeReturns: true
      }
    );
    const returnRows = Array.isArray(ordersRes?.returns) ? ordersRes.returns : [];

    // 3) Carrier mapping til returns (seneste carrier pr. order)
    const returnOrderIds = Array.from(new Set(returnRows.map(r => r[1]).filter(Boolean)));
    let orderIdToCarrier = {};
    if (returnOrderIds.length > 0) {
      const carrierRes = makeApiPostRequest_(
        `${API_BASE_URL}/fulfillments?type=carrier-map`,
        { orderIds: returnOrderIds }
      );
      (carrierRes?.data || []).forEach(m => { orderIdToCarrier[m.order_id] = m.carrier || 'Ukendt'; });
    }

    // Ryd outputområde
    clearDeliveryArea_(sheet);
    sheet.getRange('A4').setValue('🚚 DELIVERY RAPPORT').setFontWeight('bold').setFontSize(14);

    // 4) Delivery matrix (Land x Carrier)
    const deliveryMatrix = buildFulfillmentMatrix_(fulfillments?.data || []);
    let currentRow = 6;
    if (deliveryMatrix.table.length > 1) {
      sheet.getRange(currentRow, 1, deliveryMatrix.table.length, deliveryMatrix.table[0].length).setValues(deliveryMatrix.table);
      sheet.getRange(currentRow, 1, 1, deliveryMatrix.table[0].length).setFontWeight('bold').setBackground('#E3F2FD');
      currentRow += deliveryMatrix.table.length + 2;
    }

    // 5) Statistikker
    sheet.getRange(currentRow++, 1).setValue('📊 LEVERINGSSTATISTIK:').setFontWeight('bold');
    sheet.getRange(currentRow++, 1, 1, 2).setValues([[ 'Antal fulfilled ordrer:', deliveryMatrix.totalFulfillments ]]);
    sheet.getRange(currentRow++, 1, 1, 2).setValues([[ 'Antal fulfilled styk:', deliveryMatrix.totalItems ]]);

    // 6) Returns matrix (Land x Carrier) efter refundDate
    const returnsMatrix = buildReturnsMatrix_(returnRows, orderIdToCarrier);
    currentRow++;
    if (returnsMatrix.table.length > 1) {
      sheet.getRange(currentRow++, 1).setValue('♻️ RETURER PR. LAND OG LEVERANDØR:').setFontWeight('bold');
      sheet.getRange(currentRow, 1, returnsMatrix.table.length, returnsMatrix.table[0].length).setValues(returnsMatrix.table);
      sheet.getRange(currentRow, 1, 1, returnsMatrix.table[0].length).setFontWeight('bold').setBackground('#FFE3E3');
      currentRow += returnsMatrix.table.length;
    }

    // Auto-size
    sheet.autoResizeColumns(1, 12);

  } catch (error) {
    console.error('💥 Fejl i generateDeliveryReportFromAPI:', error);
    throw error;
  }
}

// Helpers til Delivery Report
function setupDeliveryDateSelector_(sheet) {
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  if (!sheet.getRange('B1').getValue()) sheet.getRange('B1').setValue(new Date());
  if (!sheet.getRange('B2').getValue()) sheet.getRange('B2').setValue(new Date());
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');
}

function getDeliverySelectedDates_(sheet) {
  let s = sheet.getRange('B1').getValue();
  let e = sheet.getRange('B2').getValue();
  const startDate = new Date(s instanceof Date ? s.getTime() : Date.now()); startDate.setHours(0,0,0,0);
  const endDate = new Date(e instanceof Date ? e.getTime() : Date.now()); endDate.setHours(23,59,59,999);
  return { startDate, endDate };
}

function clearDeliveryArea_(sheet) {
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }
}

function buildFulfillmentMatrix_(rows) {
  const carriers = new Set();
  const countries = new Set();
  const matrix = {};
  let totalFulfillments = 0;
  let totalItems = 0;

  (rows || []).forEach(r => {
    // API list mode returns array-of-arrays for Google Sheets compatibility
    const country = r[2] || 'Unknown';
    const carrier = r[3] || 'Unknown';
    const items = Number(r[4]) || 0;
    carriers.add(carrier);
    countries.add(country);
    const key = `${country}|${carrier}`;
    matrix[key] = (matrix[key] || 0) + 1;
    totalFulfillments++;
    totalItems += items;
  });

  const cols = ['Land', ...Array.from(carriers).sort()];
  const table = [cols];
  Array.from(countries).sort().forEach(cty => {
    const row = [cty];
    Array.from(carriers).sort().forEach(car => {
      row.push(matrix[`${cty}|${car}`] || 0);
    });
    table.push(row);
  });

  return { table, totalFulfillments, totalItems };
}

function buildReturnsMatrix_(returnRows, orderIdToCarrier) {
  const carriers = new Set();
  const countries = new Set();
  const matrix = {};
  let totalReturnedItems = 0;

  (returnRows || []).forEach(r => {
    const orderId = r[1];
    const country = r[3] || 'Unknown';
    const refundedQty = Number(r[9]) || 0;
    const carrier = orderIdToCarrier[orderId] || 'Ukendt';
    carriers.add(carrier);
    countries.add(country);
    const key = `${country}|${carrier}`;
    matrix[key] = (matrix[key] || 0) + 1;
    totalReturnedItems += refundedQty;
  });

  const cols = ['Land', ...Array.from(carriers).sort()];
  const table = [cols];
  Array.from(countries).sort().forEach(cty => {
    const row = [cty];
    Array.from(carriers).sort().forEach(car => {
      row.push(matrix[`${cty}|${car}`] || 0);
    });
    table.push(row);
  });

  return { table, totalReturnedItems };
}

function makeApiPostRequest_(url, body) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': `Bearer ${CONFIG.API_KEY}` },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code >= 200 && code < 300) return JSON.parse(response.getContentText());
  throw new Error('API POST error ' + code + ': ' + response.getContentText());
}