// Google Apps Script - Clean Shopify Analytics Integration
// Kun nødvendige funktioner: updateDashboard() og generateStyleColorAnalytics()

// Configuration
const CONFIG = {
  API_BASE: 'https://shopify-analytics-k469442mq-nicolais-projects-291e9559.vercel.app/api',
  API_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',
  SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),

  // Ark navne (kun de nødvendige)
  SHEETS: {
    DASHBOARD: 'Dashboard',
    STYLE_ANALYTICS: 'Style_Analytics'
  }
};

/**
 * MENU FUNKTIONER - Kun de funktioner du bruger
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Shopify Analytics')
    .addItem('Update Dashboard (30 days)', 'updateDashboard')
    .addItem('Style Analytics (Colors)', 'generateStyleColorAnalytics')
    .addItem('Style Analytics (SKUs)', 'generateStyleSKUAnalytics')
    .addSeparator()
    .addItem('Test Connection', 'testConnection')
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
    const ordreværdi = orders > 0 ? brutto / orders : 0;  // BRUTTO ordreværdi
    const basketSize = orders > 0 ? stkBrutto / orders : 0;  // BRUTTO basket size
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
    round2_(totals.orders > 0 ? totals.brutto / totals.orders : 0),  // BRUTTO ordreværdi
    totals.orders > 0 ? toFixed1_(totals.stkBrutto / totals.orders) : '0',  // BRUTTO basket size
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

/**
 * Style Color Analytics
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
      const headers = [
        'Program', 'Produkt', 'Farve', 'Artikelnummer', 'Sæson', 'Køn',
        'Beregnet købt', 'Solgt', 'Retur', 'Lager', 'Varemodtaget', 'Difference',
        'Solgt % af købt', 'Retur % af solgt', 'Kostpris', 'DB', 'Omsætning kr',
        'Status', 'Tags', 'Vejl. Pris'
      ];
      const formattedData = data.data.map(item => [
        item.program || '',
        item.produkt || '',
        item.farve || '',
        item.artikelnummer || '',
        item.season || '',
        convertGenderToDanish(item.gender),
        item.beregnetKøbt || 0,
        item.solgt || 0,
        item.retur || 0,
        item.lager || 0,
        item.varemodtaget || 0,
        item.difference || 0,
        item.solgtPct || 0,
        item.returPct || 0,
        item.kostpris || 0,
        item.db || 0,
        item.omsætning || 0,
        item.status || '',
        item.tags || '',
        item.vejlPris || 0
      ]);

      // Opdater sheet med data fra række 4
      updateSheetWithOffset('Color_Analytics', headers, formattedData, 4);
      console.log(`✅ Color Analytics opdateret med ${data.count} farver for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
    } else {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);

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
 * Style SKU Analytics - individuelle SKU'er med størrelser
 */
function generateStyleSKUAnalytics() {
  try {
    console.log('🏷️ Starter SKU analytics...');

    // Prøv at læse datoer fra SKU_Analytics sheet
    let startDate, endDate;

    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SKU_Analytics');
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
      console.log('ℹ️ SKU_Analytics sheet ikke fundet eller fejl ved læsning af datoer');
    }

    // Fallback til standard 90-dages periode hvis ingen gyldige datoer blev fundet
    if (!startDate || !endDate) {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      console.log(`📅 Bruger standard 90-dages periode: ${formatDate(startDate)} til ${formatDate(endDate)}`);
    }

    // Hent SKU-niveau data - SAMME metode som generateStyleColorAnalytics()
    const data = fetchMetadataData('style', {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      groupBy: 'sku'  // Gruppér på SKU niveau i stedet for farve
    });

    console.log(`📊 API Response: success=${data.success}, count=${data.count}, data length=${data.data ? data.data.length : 'null'}`);

    if (data.success && data.count > 0) {
      // Headers med størrelse kolonne i position G
      const headers = [
        'Program', 'Produkt', 'Farve', 'Artikelnummer', 'Sæson', 'Køn', 'Størrelse',
        'Beregnet købt', 'Solgt', 'Retur', 'Lager', 'Varemodtaget', 'Difference',
        'Solgt % af købt', 'Retur % af solgt', 'Kostpris', 'DB', 'Omsætning kr',
        'Status', 'Tags', 'Vejl. Pris'
      ];
      const formattedData = data.data.map(item => [
        item.program || '',
        item.produkt || '',
        item.farve || '',
        item.artikelnummer || '',
        item.season || '',
        convertGenderToDanish(item.gender),
        item.størrelse || '',  // Størrelse kolonne i position G
        item.beregnetKøbt || 0,
        item.solgt || 0,
        item.retur || 0,
        item.lager || 0,
        item.varemodtaget || 0,
        item.difference || 0,
        item.solgtPct || 0,
        item.returPct || 0,
        item.kostpris || 0,
        item.db || 0,
        item.omsætning || 0,
        item.status || '',
        item.tags || '',
        item.vejlPris || 0
      ]);

      // Opdater sheet med data fra række 4
      updateSheetWithOffset('SKU_Analytics', headers, formattedData, 4);
      console.log(`✅ SKU Analytics opdateret med ${data.count} SKU'er for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
    } else {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);

      // Vis besked til brugeren hvis ingen data
      if (data.success && data.count === 0) {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SKU_Analytics');
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
    console.error('💥 Fejl i generateStyleSKUAnalytics:', error);
    throw error;
  }
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

    const data = makeApiRequest(`${CONFIG.API_BASE}/analytics`, {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      type: 'raw'
    });

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
 * UTILITY FUNKTIONER
 */

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