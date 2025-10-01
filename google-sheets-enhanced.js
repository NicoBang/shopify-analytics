// Google Apps Script - Clean Shopify Analytics Integration
// Kun nødvendige funktioner: updateDashboard() og generateStyleColorAnalytics()

// Configuration
const CONFIG = {
  API_BASE: 'https://shopify-analytics-4c2oj5b1a-nicolais-projects-291e9559.vercel.app/api',
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
  ui.createMenu('📊 PdL Analytics')
    .addItem('📊 Dashboard', 'updateDashboard')
    .addItem('🎨 Color Analytics', 'generateStyleColorAnalytics')
    .addItem('🎨 SKU Analytics', 'generateStyleSKUAnalytics')
    .addItem('🔢 Style Analytics', 'generateStyleNumberAnalytics')
    .addItem('🚚 Delivery Report', 'generateDeliveryAnalytics')
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
    // shipping er allerede ex moms, og shipping tax er inkluderet i tax
    // brutto = hvad vi har solgt produkter for ex moms
    const brutto = discountedTotal - tax - shipping;

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
    const stkPris = stkBrutto > 0 ? brutto / stkBrutto : 0;  // Gns. stykpris = brutto / brutto antal
    const ordreværdi = orders > 0 ? brutto / orders : 0;     // Gns. ordreværdi = brutto / orders
    const basketSize = orders > 0 ? stkBrutto / orders : 0;  // Basket size = brutto antal / orders
    const returStkPct = stkBrutto > 0 ? s.refundedQty / stkBrutto : 0;
    const returKrPct = brutto > 0 ? o.refundedAmount / brutto : 0;
    const returOrdrePct = orders > 0 ? o.refundOrders.size / orders : 0;
    const fragtPct = brutto > 0 ? fragt / brutto : 0;  // Fragt % af brutto

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
    round2_(totals.orders > 0 ? totals.brutto / totals.orders : 0),  // Gns. ordreværdi = brutto / orders
    totals.orders > 0 ? toFixed1_(totals.stkBrutto / totals.orders) : '0',  // Basket size = brutto antal / orders
    round2_(totals.stkBrutto > 0 ? totals.brutto / totals.stkBrutto : 0),  // Gns. stykpris total = brutto / brutto antal
    pctStr_(totals.stkBrutto > 0 ? (totals.returStk / totals.stkBrutto) : 0),
    pctStr_(totals.brutto > 0 ? (totals.returKr / totals.brutto) : 0),
    pctStr_(totals.orders > 0 ? (totals.returOrdre / totals.orders) : 0),
    round2_(totals.fragt),
    toFixed2_(totals.brutto > 0 ? (totals.fragt / totals.brutto * 100) : 0),  // Fragt % af brutto
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
        const startDateCell = sheet.getRange('B1').getValue();
        const endDateCell = sheet.getRange('B2').getValue();

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

            // Setup labels og datoer som Dashboard
            sheet.getRange('A1').setValue('Startdato:');
            sheet.getRange('A2').setValue('Slutdato:');
            sheet.getRange('A1:A2').setFontWeight('bold');

            // Kun sæt datoer hvis cellerne er helt tomme
            if (!startDateCell) sheet.getRange('B1').setValue(defaultStart);
            if (!endDateCell) sheet.getRange('B2').setValue(today);
            sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

            startDate = startDateCell || defaultStart;
            endDate = endDateCell || today;
            console.log(`📅 Oprettede standard datoer. Rediger B1 og B2 for at vælge periode.`);
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
        const startDateCell = sheet.getRange('B1').getValue();
        const endDateCell = sheet.getRange('B2').getValue();

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

            // Setup labels og datoer som Dashboard
            sheet.getRange('A1').setValue('Startdato:');
            sheet.getRange('A2').setValue('Slutdato:');
            sheet.getRange('A1:A2').setFontWeight('bold');

            // Kun sæt datoer hvis cellerne er helt tomme
            if (!startDateCell) sheet.getRange('B1').setValue(defaultStart);
            if (!endDateCell) sheet.getRange('B2').setValue(today);
            sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

            startDate = startDateCell || defaultStart;
            endDate = endDateCell || today;
            console.log(`📅 Oprettede standard datoer. Rediger B1 og B2 for at vælge periode.`);
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
 * Style Number Analytics - individuelle stamvarenumre (samler farver)
 */
function generateStyleNumberAnalytics() {
  try {
    console.log('🔢 Starter stamvarenummer analytics...');

    // Prøv at læse datoer fra Number_Analytics sheet
    let startDate, endDate;

    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Number_Analytics');
      if (sheet) {
        const startDateCell = sheet.getRange('B1').getValue();
        const endDateCell = sheet.getRange('B2').getValue();

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

            // Setup labels og datoer som Dashboard
            sheet.getRange('A1').setValue('Startdato:');
            sheet.getRange('A2').setValue('Slutdato:');
            sheet.getRange('A1:A2').setFontWeight('bold');

            // Kun sæt datoer hvis cellerne er helt tomme
            if (!startDateCell) sheet.getRange('B1').setValue(defaultStart);
            if (!endDateCell) sheet.getRange('B2').setValue(today);
            sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

            startDate = startDateCell || defaultStart;
            endDate = endDateCell || today;
            console.log(`📅 Oprettede standard datoer. Rediger B1 og B2 for at vælge periode.`);
          }
        }
      }
    } catch (sheetError) {
      console.log('ℹ️ Number_Analytics sheet ikke fundet eller fejl ved læsning af datoer');
    }

    // Fallback til standard 90-dages periode hvis ingen gyldige datoer blev fundet
    if (!startDate || !endDate) {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      console.log(`📅 Bruger standard 90-dages periode: ${formatDate(startDate)} til ${formatDate(endDate)}`);
    }

    // Hent stamvarenummer-niveau data
    const data = fetchMetadataData('style', {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      groupBy: 'stamvarenummer'
    });

    console.log(`📊 API Response: success=${data.success}, count=${data.count}, data length=${data.data ? data.data.length : 'null'}`);

    if (data.success && data.count > 0) {
      // Headers uden Farve kolonne (stamvarenummer samler farver)
      const headers = [
        'Program', 'Produkt', 'Stamvarenummer', 'Sæson', 'Køn',
        'Beregnet købt', 'Solgt', 'Retur', 'Lager', 'Varemodtaget', 'Difference',
        'Solgt % af købt', 'Retur % af solgt', 'Kostpris', 'DB', 'Omsætning kr',
        'Status', 'Vejl. Pris'
      ];
      const formattedData = data.data.map(item => [
        item.program || '',
        item.produkt || '',
        item.stamvarenummer || '',
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
        item.vejlPris || 0
      ]);

      // Opdater sheet med data fra række 4
      updateSheetWithOffset('Number_Analytics', headers, formattedData, 4);
      console.log(`✅ Number Analytics opdateret med ${data.count} stamvarenumre for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
    } else {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);

      // Vis besked til brugeren hvis ingen data
      if (data.success && data.count === 0) {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Number_Analytics');
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
    console.error('💥 Fejl i generateStyleNumberAnalytics:', error);
    throw error;
  }
}

/**
 * Delivery Analytics - leveringsrapport med returner
 */
function generateDeliveryAnalytics() {
  try {
    console.log('🚚 Starter delivery analytics...');

    // Prøv at læse datoer fra Delivery_Analytics sheet
    let startDate, endDate;

    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Delivery_Analytics');
      if (sheet) {
        const startDateCell = sheet.getRange('B1').getValue();
        const endDateCell = sheet.getRange('B2').getValue();

        if (startDateCell instanceof Date && endDateCell instanceof Date) {
          startDate = new Date(startDateCell);
          endDate = new Date(endDateCell);

          if (startDate.toDateString() === endDate.toDateString()) {
            endDate.setHours(23, 59, 59, 999);
            console.log(`📅 Samme dag valgt - analyserer hele dagen: ${formatDate(startDate)}`);
          } else {
            console.log(`📅 Bruger brugerdefinerede datoer: ${formatDate(startDate)} til ${formatDate(endDate)}`);
          }
        } else {
          if (!startDateCell || !endDateCell) {
            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 30);

            sheet.getRange('A1').setValue('Startdato:');
            sheet.getRange('A2').setValue('Slutdato:');
            sheet.getRange('A1:A2').setFontWeight('bold');

            if (!startDateCell) sheet.getRange('B1').setValue(defaultStart);
            if (!endDateCell) sheet.getRange('B2').setValue(today);
            sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

            startDate = startDateCell || defaultStart;
            endDate = endDateCell || today;
            console.log(`📅 Oprettede standard datoer. Rediger B1 og B2 for at vælge periode.`);
          }
        }
      }
    } catch (sheetError) {
      console.log('ℹ️ Delivery_Analytics sheet ikke fundet eller fejl ved læsning af datoer');
    }

    if (!startDate || !endDate) {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      console.log(`📅 Bruger standard 30-dages periode: ${formatDate(startDate)} til ${formatDate(endDate)}`);
    }

    // Hent enhanced delivery data
    const url = `${CONFIG.API_BASE}/fulfillments`;
    const payload = {
      type: 'enhanced',
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true)
    };
    const response = makeApiRequest(url, payload);

    console.log(`📊 API Response: success=${response.success}, count=${response.count}`);

    if (response.success && response.data) {
      renderDeliveryAnalytics(response.data, startDate, endDate);
      console.log(`✅ Delivery Analytics opdateret for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
    } else {
      console.log(`⚠️ Ingen leveringsdata fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Delivery_Analytics');
      if (sheet) {
        if (sheet.getLastRow() >= 4) {
          const lastRow = sheet.getLastRow();
          const lastCol = sheet.getLastColumn();
          if (lastRow >= 4 && lastCol > 0) {
            sheet.getRange(4, 1, lastRow - 4 + 1, lastCol).clear();
          }
        }
        sheet.getRange('A4').setValue(`Ingen data for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
        sheet.getRange('A4').setFontStyle('italic').setFontColor('#666666');
      }
    }

  } catch (error) {
    console.error('💥 Fejl i generateDeliveryAnalytics:', error);
    throw error;
  }
}

function renderDeliveryAnalytics(data, startDate, endDate) {
  const sheet = getOrCreateSheet('Delivery_Analytics');

  // Clear fra række 4
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  let currentRow = 4;

  // Title
  sheet.getRange(currentRow, 1).setValue(`🚚 LEVERINGSRAPPORT: ${formatDate(startDate)} - ${formatDate(endDate)}`);
  sheet.getRange(currentRow, 1).setFontWeight('bold').setFontSize(14);
  currentRow += 2;

  // Fulfillment Matrix - konverter fra "country|carrier": count til nested object
  sheet.getRange(currentRow, 1).setValue('📦 LEVERINGER PER LAND OG LEVERANDØR');
  sheet.getRange(currentRow, 1).setFontWeight('bold').setFontSize(12);
  currentRow += 1;

  const rawFulfillmentMatrix = data.fulfillmentMatrix || {};
  const fulfillmentMatrix = {};
  const carriers = new Set();

  // Parse "country|carrier": count til nested {country: {carrier: count}}
  Object.entries(rawFulfillmentMatrix).forEach(([key, count]) => {
    const [country, carrier] = key.split('|');
    if (!fulfillmentMatrix[country]) fulfillmentMatrix[country] = {};
    fulfillmentMatrix[country][carrier] = count;
    carriers.add(carrier);
  });

  const countries = Object.keys(fulfillmentMatrix).sort();
  const carrierList = Array.from(carriers).sort();

  // Headers
  const headers = ['Land', ...carrierList, 'Total'];
  sheet.getRange(currentRow, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(currentRow, 1, 1, headers.length).setFontWeight('bold').setBackground('#E3F2FD');
  currentRow += 1;

  // Data rows
  let totalByCarrier = {};
  carrierList.forEach(c => totalByCarrier[c] = 0);
  let grandTotal = 0;

  countries.forEach(country => {
    const row = [country];
    let countryTotal = 0;

    carrierList.forEach(carrier => {
      const count = fulfillmentMatrix[country]?.[carrier] || 0;
      row.push(count);
      countryTotal += count;
      totalByCarrier[carrier] += count;
    });

    row.push(countryTotal);
    grandTotal += countryTotal;
    sheet.getRange(currentRow, 1, 1, row.length).setValues([row]);
    currentRow += 1;
  });

  // Total row
  const totalRow = ['Total', ...carrierList.map(c => totalByCarrier[c]), grandTotal];
  sheet.getRange(currentRow, 1, 1, totalRow.length).setValues([totalRow]);
  sheet.getRange(currentRow, 1, 1, totalRow.length).setFontWeight('bold').setBackground('#F0F8FF');
  currentRow += 2;

  // Returns Matrix - konverter fra "country|carrier": count til nested object
  sheet.getRange(currentRow, 1).setValue('🔄 RETURER PER LAND OG LEVERANDØR');
  sheet.getRange(currentRow, 1).setFontWeight('bold').setFontSize(12);
  currentRow += 1;

  const rawReturnMatrix = data.returnsMatrix || {};
  const returnMatrix = {};
  const returnCarriers = new Set();

  // Parse "country|carrier": count til nested {country: {carrier: count}}
  Object.entries(rawReturnMatrix).forEach(([key, count]) => {
    const [country, carrier] = key.split('|');
    if (!returnMatrix[country]) returnMatrix[country] = {};
    returnMatrix[country][carrier] = count;
    returnCarriers.add(carrier);
  });

  const returnCountries = Object.keys(returnMatrix).sort();
  const returnCarrierList = Array.from(returnCarriers).sort();

  // Headers
  const returnHeaders = ['Land', ...returnCarrierList, 'Total'];
  sheet.getRange(currentRow, 1, 1, returnHeaders.length).setValues([returnHeaders]);
  sheet.getRange(currentRow, 1, 1, returnHeaders.length).setFontWeight('bold').setBackground('#FFE0E0');
  currentRow += 1;

  // Data rows
  let returnTotalByCarrier = {};
  returnCarrierList.forEach(c => returnTotalByCarrier[c] = 0);
  let returnGrandTotal = 0;

  returnCountries.forEach(country => {
    const row = [country];
    let countryTotal = 0;

    returnCarrierList.forEach(carrier => {
      const count = returnMatrix[country]?.[carrier] || 0;
      row.push(count);
      countryTotal += count;
      returnTotalByCarrier[carrier] += count;
    });

    row.push(countryTotal);
    returnGrandTotal += countryTotal;
    sheet.getRange(currentRow, 1, 1, row.length).setValues([row]);
    currentRow += 1;
  });

  // Total row
  const returnTotalRow = ['Total', ...returnCarrierList.map(c => returnTotalByCarrier[c]), returnGrandTotal];
  sheet.getRange(currentRow, 1, 1, returnTotalRow.length).setValues([returnTotalRow]);
  sheet.getRange(currentRow, 1, 1, returnTotalRow.length).setFontWeight('bold').setBackground('#F0F8FF');
  currentRow += 2;

  // Summary stats
  sheet.getRange(currentRow, 1).setValue('📊 SAMMENDRAG');
  sheet.getRange(currentRow, 1).setFontWeight('bold').setFontSize(12);
  currentRow += 1;

  const summary = [
    ['Antal fulfilled ordrer:', grandTotal],
    ['Antal fulfilled styk:', data.totalFulfilledItems || 0],
    ['Antal returneret styk:', data.totalReturnedItems || 0],
    ['Antal returneret ordrer:', returnGrandTotal],
    ['Retur rate (ordrer):', grandTotal > 0 ? `${((returnGrandTotal / grandTotal) * 100).toFixed(2)}%` : '0%'],
    ['Retur rate (styk):', data.totalFulfilledItems > 0 ? `${(((data.totalReturnedItems || 0) / data.totalFulfilledItems) * 100).toFixed(2)}%` : '0%']
  ];

  summary.forEach(row => {
    sheet.getRange(currentRow, 1, 1, 2).setValues([row]);
    currentRow += 1;
  });

  // Auto-resize
  sheet.autoResizeColumns(1, Math.max(headers.length, returnHeaders.length));
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