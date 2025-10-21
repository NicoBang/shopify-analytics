// Google Apps Script - Clean Shopify Analytics Integration
// Kun nødvendige funktioner: updateDashboard() og generateStyleColorAnalytics()

// Configuration
const CONFIG = {
  // Supabase Edge Functions (PRIMARY)
  SUPABASE_BASE: 'https://ihawjrtfwysyokfotewn.supabase.co/functions/v1',
  SUPABASE_KEY: '@Za#SJxn;gnBxJ;Iu2uixoUd&#\'ndl',

  // Vercel API (FALLBACK)
  VERCEL_BASE: 'https://shopify-analytics-nu.vercel.app/api',
  VERCEL_KEY: 'bda5da3d49fe0e7391fded3895b5c6bc',

  // Legacy config (will be removed after migration)
  API_BASE: 'https://shopify-analytics-nu.vercel.app/api',
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
/**
 * MENU FUNKTIONER - Kun de funktioner du bruger
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  // V2 submenu (PRE-AGGREGATION)
  const v2Menu = ui.createMenu('⚡ V2 (Pre-aggregation)')
    .addItem('📊 Dashboard V2', 'updateDashboard_V2')
    .addItem('🎨 Color Analytics V2', 'generateStyleColorAnalytics_V2')
    .addItem('🎨 SKU Analytics V2', 'generateStyleSKUAnalytics_V2')
    .addItem('🔢 Style Analytics V2', 'generateStyleNumberAnalytics_V2')
    .addItem('🚚 Delivery Report V2', 'generateDeliveryAnalytics_V2')
    .addSeparator()
    .addItem('Test Connection V2', 'testConnection_V2');

  // Main menu
  ui.createMenu('📊 PdL Analytics')
    .addItem('📊 Dashboard', 'updateDashboard')
    .addItem('🎨 Color Analytics', 'generateStyleColorAnalytics')
    .addItem('🎨 SKU Analytics', 'generateStyleSKUAnalytics')
    .addItem('🔢 Style Analytics', 'generateStyleNumberAnalytics')
    .addItem('🚚 Delivery Report', 'generateDeliveryAnalytics')
    .addSeparator()
    .addSubMenu(v2Menu)
    .addSeparator()
    .addItem('Test Connection', 'testConnection')
    .addSeparator()
    .addItem('⚙️ Opret On open-trigger', 'ensureOnOpenTrigger') // ← valgfri genvej
    .addToUi();
}

/**
 * Kører automatisk ved åbning – men via installérbar trigger (som EJEREN).
 * Læg kun det herind, der skal ske automatisk.
 */
function onOpenHandler(e) {
  try {
    updateDashboard(); // eksempel: opdatér dashboard ved åbning
    // andre letvægtsopgaver...
  } catch (err) {
    console.error(err);
  }
}

/**
 * Engangskørsel: opretter den installérbare On open-trigger programmatisk.
 * Kør denne som ejeren (enten fra menuen eller fra editoren).
 */
function ensureOnOpenTrigger() {
  const ssId = SpreadsheetApp.getActive().getId();
  const exists = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === 'onOpenHandler' &&
    t.getEventType() === ScriptApp.EventType.ON_OPEN
  );
  if (!exists) {
    ScriptApp.newTrigger('onOpenHandler')
      .forSpreadsheet(ssId)
      .onOpen()
      .create();
    SpreadsheetApp.getActive().toast('On open-trigger oprettet ✅');
  } else {
    SpreadsheetApp.getActive().toast('On open-trigger findes allerede ✅');
  }
}

/**
 * HOVEDFUNKTIONER
 */

/**
 * Opdater dashboard med de sidste 30 dages data
 * UPDATED: Nu bruger dashboard-sku endpoint (kombinerer SKU + orders data)
 */
function updateDashboard() {
  try {
    console.log('🚀 Starter dashboard opdatering...');

    // Læs datoer fra Dashboard arket (B1/B2). Fallback: sidste 30 dage
    const { startDate, endDate } = getDashboardSelectedDates_();

    // Brug dashboard-sku endpoint
    const dashboardUrl = `${CONFIG.API_BASE}/analytics`;
    const dashboardPayload = {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      type: 'dashboard-sku'
    };
    const dashboardRes = makeApiRequest(dashboardUrl, dashboardPayload);

    if (!dashboardRes.success || !dashboardRes.data) {
      throw new Error('Dashboard data kunne ikke hentes');
    }

    // Brug renderDashboardFromSkus_() funktion
    renderDashboardFromSkus_(dashboardRes.data, startDate, endDate);
    console.log(`✅ Dashboard opdateret fra dashboard-sku endpoint (${dashboardRes.data.length} shops)`);

  } catch (error) {
    console.error('💥 Fejl i updateDashboard:', error);
    throw error;
  }
}

// Render Dashboard fra SKU-baserede beregninger (Updated October 2025)
function renderDashboardFromSkus_(dashboardData, startDate, endDate) {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.DASHBOARD);

  // Sæt dato inputs i toppen (A1/A2)
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

  // Ryd alt under række 4
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  // Headers - alle 16 kolonner som før
  const headers = [
    'Shop','Bruttoomsætning','Nettoomsætning',
    'Antal stk Brutto','Antal stk Netto','Antal Ordrer',
    'Gnst ordreværdi','Basket size','Gns. stykpris',
    'Retur % i stk','Retur % i kr','Retur % i antal o',
    'Fragt indtægt ex','% af oms','Rabat ex moms','Cancelled stk'
  ];
  sheet.getRange('A4:P4').setValues([headers]).setFontWeight('bold').setBackground('#E3F2FD');

  // Byg rækker fra dashboard data
  const rows = [];
  const totals = {
    brutto:0, netto:0, stkBrutto:0, stkNetto:0, orders:0,
    returStk:0, returKr:0, returOrdre:0, fragt:0, rabat:0, cancelled:0
  };

  dashboardData.forEach(shopData => {
    const brutto = shopData.bruttoomsætning || 0;
    const netto = shopData.nettoomsætning || 0;
    const stkBrutto = shopData.stkBrutto || 0;
    const stkNetto = shopData.stkNetto || 0;
    const returQty = shopData.returQty || 0;
    const refundedAmount = shopData.refundedAmount || 0;
    const orders = shopData.antalOrdrer || 0;
    const shipping = shopData.shipping || 0;
    const rabat = shopData.totalDiscounts || 0;
    const cancelled = shopData.cancelledQty || 0;

    // Brug afledte værdier fra API (allerede beregnet)
    const ordreværdi = shopData.gnstOrdreværdi || 0;
    const basketSize = shopData.basketSize || 0;
    const stkPris = shopData.gnsStkpris || 0;
    const returStkPct = shopData.returPctStk || 0;
    const returKrPct = shopData.returPctKr || 0;
    const returOrdrePct = shopData.returPctOrdre || 0;
    const fragtPct = shopData.fragtPctAfOms || 0;

    rows.push([
      shopLabel_(shopData.shop),
      round2_(brutto),
      round2_(netto),
      stkBrutto,
      stkNetto,
      orders,
      round2_(ordreværdi),
      toFixed1_(basketSize),
      round2_(stkPris),
      pctStr_(returStkPct / 100),  // API returnerer som 0-100, vi vil have 0-1
      pctStr_(returKrPct / 100),
      pctStr_(returOrdrePct / 100),
      round2_(shipping),
      pctStr_(fragtPct / 100),
      round2_(rabat),
      cancelled
    ]);

    totals.brutto += brutto;
    totals.netto += netto;
    totals.stkBrutto += stkBrutto;
    totals.stkNetto += stkNetto;
    totals.orders += orders;
    totals.returStk += returQty;
    totals.returKr += refundedAmount;
    totals.returOrdre += (shopData.returOrderCount || 0); // ✅ FIXED: Sum antal ordrer med refunds
    totals.fragt += shipping;
    totals.rabat += rabat;
    totals.cancelled += cancelled;
  });

  // Total række
  const totalReturOrdrePct = totals.orders > 0 ? (totals.returOrdre / totals.orders) : 0;
  const totalFragtPct = totals.brutto > 0 ? (totals.fragt / totals.brutto) : 0;

  rows.push([
    'I alt',
    round2_(totals.brutto),
    round2_(totals.netto),
    totals.stkBrutto,
    totals.stkNetto,
    totals.orders,
    round2_(totals.orders > 0 ? totals.brutto / totals.orders : 0),
    totals.orders > 0 ? toFixed1_(totals.stkBrutto / totals.orders) : '0',
    round2_(totals.stkBrutto > 0 ? totals.brutto / totals.stkBrutto : 0),
    pctStr_(totals.stkBrutto > 0 ? (totals.returStk / totals.stkBrutto) : 0),
    pctStr_(totals.brutto > 0 ? (totals.returKr / totals.brutto) : 0),
    pctStr_(totalReturOrdrePct),
    round2_(totals.fragt),
    pctStr_(totalFragtPct),
    round2_(totals.rabat),
    totals.cancelled
  ]);

  if (rows.length > 0) {
    sheet.getRange(5, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(5 + rows.length - 1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#F0F8FF');
    sheet.autoResizeColumns(1, rows[0].length);
  }
}

// Render Dashboard identisk med det gamle GAS-setup
// UPDATED: Now accepts optional shopBreakdown parameter for SKU-level cancelled amounts
function renderDashboard_(orderRows, returnRows, startDate, endDate, shopBreakdown = null) {
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

  // Track which returns we've already counted in orderRows
  const processedReturns = new Set();

  // Ordrer oprettet i perioden
  orderRows.forEach(row => {
    if (!row || row.length < 15) return;
    const shop = row[IDX.SHOP];
    if (!shopMap[shop]) return;

    const orderId = row[IDX.ORDER_ID];

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
    shopMap[shop].orders.add(orderId);

    const cancelledQty = toNum_(row[IDX.CANCELLED_QTY]);
    const itemCount = toNum_(row[IDX.ITEM_COUNT]);
    // Brutto antal skal ekskludere annulleringer
    const bruttoQty = Math.max(0, itemCount - cancelledQty);
    skuStats[shop].qty += bruttoQty;
    // Netto starter fra brutto (allerede uden annulleringer) og reduceres senere af retur
    skuStats[shop].qtyNet += bruttoQty;
    skuStats[shop].cancelledQty += cancelledQty;

    // NOTE: Cancelled amount deduction is handled via SKU-level data in shopBreakdown
    // Old proportional calculation has been removed to avoid double-deduction
    // Fallback: If shopBreakdown is null, use proportional calculation
    if (!shopBreakdown && itemCount > 0 && cancelledQty > 0) {
      const perUnitExTax = brutto / itemCount;
      const cancelValueExTax = perUnitExTax * cancelledQty;
      // Træk fra både brutto (B) og netto (C)
      shopMap[shop].gross -= cancelValueExTax;
      shopMap[shop].net -= cancelValueExTax;
      console.log(`⚠️  FALLBACK: Using proportional calculation for ${shop} order ${orderId} (cancelled_amount_dkk not available)`);
    }

    // Håndter returer for ordrer i perioden (undgå dobbelt-træk senere)
    const refundedAmount = toNum_(row[IDX.REFUNDED_AMOUNT]);
    const refundedQty = toNum_(row[IDX.REFUNDED_QTY]);
    const refundDate = row[IDX.REFUND_DATE];

    // KUN tæl returen hvis refund_date er inden for denne periode
    if (refundDate && refundedAmount > 0) {
      const refundDateObj = new Date(refundDate);
      if (refundDateObj >= startDate && refundDateObj <= endDate) {
        shopMap[shop].net -= refundedAmount;
        shopMap[shop].refundedAmount += refundedAmount;
        if (refundedQty > 0) {
          shopMap[shop].refundOrders.add(orderId);
        }
        skuStats[shop].refundedQty += refundedQty;
        skuStats[shop].qtyNet -= refundedQty;
        // Mark this return as processed so we don't count it again in returnRows
        processedReturns.add(orderId);
      }
    }
  });

  // Returer dateret på refund_date i perioden
  returnRows.forEach(row => {
    if (!row || row.length < 15) return;
    const shop = row[IDX.SHOP];
    if (!shopMap[shop]) return;

    const orderId = row[IDX.ORDER_ID];
    const refundedAmount = toNum_(row[IDX.REFUNDED_AMOUNT]);
    const refundedQty = toNum_(row[IDX.REFUNDED_QTY]);
    const refundDate = row[IDX.REFUND_DATE];
    if (!refundDate) return;

    // Skip if we already counted this return in orderRows
    if (processedReturns.has(orderId)) {
      return;
    }

    // This return is from an order created in an earlier period
    // Only subtract the return value (order creation not in this period)
    shopMap[shop].net -= refundedAmount;
    shopMap[shop].refundedAmount += refundedAmount;
    if (refundedQty > 0) {
      shopMap[shop].refundOrders.add(orderId);
    }
    skuStats[shop].refundedQty += refundedQty;
    skuStats[shop].qtyNet -= refundedQty;
  });

  // If shopBreakdown exists, use SKU-level revenue (with precise cancelled amounts)
  if (shopBreakdown && shopBreakdown.length > 0) {
    console.log('✅ Using SKU-level cancelled amounts from shopBreakdown');
    shopBreakdown.forEach(breakdown => {
      const shop = breakdown.shop;
      if (!shopMap[shop]) return;

      // Calculate revenue components from SKU-level data
      const totalRevenue = breakdown.revenue || 0;           // Brutto (gross revenue)
      const cancelledAmount = breakdown.cancelledAmount || 0; // Cancelled items value

      // Override the order-level calculated values
      shopMap[shop].gross = totalRevenue;
      shopMap[shop].net = totalRevenue - cancelledAmount;  // ✅ Subtract cancelled amounts from net

      // Logging for transparency
      if (cancelledAmount === 0) {
        console.log(`   ${shop}: Brutto=${totalRevenue.toFixed(2)}, Cancelled=0 (no cancellations)`);
      } else {
        console.log(`✅ Using SKU-level net revenue calculation`);
        console.log(`   ${shop}: Brutto=${totalRevenue.toFixed(2)}, Cancelled=${cancelledAmount.toFixed(2)}, Netto=${(totalRevenue - cancelledAmount).toFixed(2)}`);
      }
    });
  } else {
    console.log('⚠️  No shopBreakdown available - using order-level proportional calculation');
  }

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
 * Lav API request med Supabase-first failover til Vercel
 */
function makeApiRequest(url, params = {}) {
  // Byg query parameters
  const queryParams = Object.entries(params)
    .filter(([_, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  const queryString = queryParams ? `?${queryParams}` : '';

  // Determine endpoint type from URL
  let endpoint = '';
  if (url.includes('/metadata')) {
    endpoint = 'metadata';
  } else if (url.includes('/analytics-v2')) {
    endpoint = 'analytics-v2';
  } else if (url.includes('/color-analytics-v2')) {
    endpoint = 'color-analytics-v2';
  } else if (url.includes('/sku-analytics-v2')) {
    endpoint = 'sku-analytics-v2';
  } else if (url.includes('/analytics')) {
    endpoint = 'api-analytics';
  } else if (url.includes('/fulfillments')) {
    endpoint = 'fulfillments';
  }

  // Try Supabase first (if endpoint is migrated)
  if (endpoint === 'api-analytics' || endpoint === 'analytics-v2' || endpoint === 'color-analytics-v2' || endpoint === 'sku-analytics-v2') {
    try {
      const supabaseUrl = `${CONFIG.SUPABASE_BASE}/${endpoint}${queryString}`;
      console.log(`🔗 [Supabase] API Request: ${supabaseUrl}`);

      const supabaseOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        },
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(supabaseUrl, supabaseOptions);
      const responseCode = response.getResponseCode();

      if (responseCode === 200) {
        const data = JSON.parse(response.getContentText());
        if (!data.error) {
          console.log(`✅ Supabase Success`);
          return data;
        }
      }

      console.log(`⚠️ Supabase returned ${responseCode}, falling back to Vercel...`);
    } catch (supabaseError) {
      console.error(`⚠️ Supabase error: ${supabaseError.message}, falling back to Vercel...`);
    }
  }

  // Fallback to Vercel (or primary if not migrated yet)
  try {
    const vercelUrl = `${url}${queryString}`;
    console.log(`🔗 [Vercel] API Request: ${vercelUrl}`);

    const vercelOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.VERCEL_KEY}`
      }
    };

    const response = UrlFetchApp.fetch(vercelUrl, vercelOptions);
    const data = JSON.parse(response.getContentText());

    if (data.error) {
      throw new Error(data.error);
    }

    console.log(`✅ Vercel Success`);
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
 * Check if a date is in Danish Summer Time (CEST)
 * CEST: Last Sunday of March 02:00 to Last Sunday of October 03:00
 * CET: Rest of year
 */
function isDanishDST_(year, month, day) {
  // Before March or after October: definitely winter time
  if (month < 3 || month > 10) return false;
  
  // April to September: definitely summer time
  if (month > 3 && month < 10) return true;
  
  // March: check if we're past the last Sunday
  if (month === 3) {
    const lastSunday = getLastSundayOfMonth_(year, 3);
    return day >= lastSunday;
  }
  
  // October: check if we're before the last Sunday
  if (month === 10) {
    const lastSunday = getLastSundayOfMonth_(year, 10);
    return day < lastSunday;
  }
  
  return false;
}

/**
 * Get the day of the last Sunday in a given month
 */
function getLastSundayOfMonth_(year, month) {
  // Start from last day of month and work backwards
  const lastDay = new Date(year, month, 0).getDate();
  
  for (let day = lastDay; day >= 1; day--) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 0) { // Sunday
      return day;
    }
  }
  
  return lastDay; // Fallback (should never happen)
}

/**
 * Formater start/slut dato med korrekt tid for API
 * Both V1 and V2 APIs expect UTC timestamps with Danish timezone compensation
 * V1: Filters created_at_original (TIMESTAMPTZ) via adjustLocalDateToUTC()
 * V2: Parses UTC timestamp and adds Danish offset internally (analytics-v2.js lines 33-45)
 */
function formatDateWithTime(date, isEndDate = false) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const isDST = isDanishDST_(year, month + 1, day);
  const offset = isDST ? 2 : 1;

  console.log(`🔍 DEBUG [formatDateWithTime]: ${isEndDate ? 'End' : 'Start'} date ${year}-${month+1}-${day}, DST=${isDST}, offset=${offset}h`);

  let utcDate = new Date(Date.UTC(year, month, day, 0, 0, 0));

  if (isEndDate) {
    utcDate.setUTCHours(24 - offset, 0, 0, 0);
    utcDate.setUTCMilliseconds(-1); // 23:59:59.999
  } else {
    utcDate.setUTCHours(0 - offset, 0, 0, 0);
  }

  console.log(`   Result: ${utcDate.toISOString()}`);

  return utcDate.toISOString();
}
/**
 * ========================================
 * V2 FUNCTIONS (PRE-AGGREGATION)
 * Uses analytics-v2.js endpoint with daily_shop_metrics
 * ========================================
 */

/**
 * Opdater dashboard V2 med pre-aggregation
 */
function updateDashboard_V2() {
  try {
    console.log('🚀 Starter dashboard V2 opdatering (pre-aggregation)...');

    // Læs datoer fra Dashboard_2_0 arket (B1/B2). Fallback: sidste 30 dage
    const { startDate, endDate } = getDashboardSelectedDates_V2();

    // Brug analytics-v2 endpoint (PRE-AGGREGATION)
    const dashboardUrl = `${CONFIG.API_BASE}/analytics-v2`;
    const formattedStart = formatDateWithTime(startDate, false);
    const formattedEnd = formatDateWithTime(endDate, true);
    console.log(`🔍 DEBUG [Google Sheets]: Sending timestamps to V2 API: ${formattedStart} to ${formattedEnd}`);
    const dashboardPayload = {
      startDate: formattedStart,
      endDate: formattedEnd,
      type: 'dashboard-sku'
    };
    const dashboardRes = makeApiRequest(dashboardUrl, dashboardPayload);

    if (!dashboardRes.success || !dashboardRes.data) {
      throw new Error('Dashboard data kunne ikke hentes');
    }

    // Brug renderDashboardFromSkus_V2() funktion
    renderDashboardFromSkus_V2(dashboardRes.data, startDate, endDate);
    console.log(`✅ Dashboard V2 opdateret fra pre-aggregation (${dashboardRes.data.length} shops)`);

  } catch (error) {
    console.error('💥 Fejl i updateDashboard_V2:', error);
    throw error;
  }
}

function renderDashboardFromSkus_V2(dashboardData, startDate, endDate) {
  const sheet = getOrCreateSheet('Dashboard_2_0');

  // Sæt dato inputs i toppen (A1/A2)
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

  // Ryd alt under række 4
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  // Headers
  const headers = [
    'Shop','Bruttoomsætning','Nettoomsætning',
    'Antal stk Brutto','Antal stk Netto','Antal Ordrer',
    'Gnst ordreværdi','Basket size','Gns. stykpris',
    'Retur % i stk','Retur % i kr','Retur % i antal o',
    'Fragt indtægt ex','% af oms','Rabat ex moms','Cancelled stk'
  ];
  sheet.getRange('A4:P4').setValues([headers]).setFontWeight('bold').setBackground('#E3F2FD');

  // Byg rækker
  const rows = [];
  const totals = {
    brutto:0, netto:0, stkBrutto:0, stkNetto:0, orders:0,
    returStk:0, returKr:0, returOrdre:0, fragt:0, rabat:0, cancelled:0
  };

  dashboardData.forEach(shopData => {
    const brutto = shopData.bruttoomsætning || 0;
    const netto = shopData.nettoomsætning || 0;
    const stkBrutto = shopData.stkBrutto || 0;
    const stkNetto = shopData.stkNetto || 0;
    const returQty = shopData.returQty || 0;
    const refundedAmount = shopData.refundedAmount || 0;
    const orders = shopData.antalOrdrer || 0;
    const shipping = shopData.shipping || 0;
    const rabat = shopData.totalDiscounts || 0;
    const cancelled = shopData.cancelledQty || 0;

    // Brug afledte værdier fra API
    const ordreværdi = shopData.gnstOrdreværdi || 0;
    const basketSize = shopData.basketSize || 0;
    const stkPris = shopData.gnsStkpris || 0;
    const returStkPct = shopData.returPctStk || 0;
    const returKrPct = shopData.returPctKr || 0;
    const returOrdrePct = shopData.returPctOrdre || 0;
    const fragtPct = shopData.fragtPctAfOms || 0;

    rows.push([
      shopLabel_(shopData.shop),
      round2_(brutto),
      round2_(netto),
      stkBrutto,
      stkNetto,
      orders,
      round2_(ordreværdi),
      toFixed1_(basketSize),
      round2_(stkPris),
      pctStr_(returStkPct / 100),
      pctStr_(returKrPct / 100),
      pctStr_(returOrdrePct / 100),
      round2_(shipping),
      pctStr_(fragtPct / 100),
      round2_(rabat),
      cancelled
    ]);

    totals.brutto += brutto;
    totals.netto += netto;
    totals.stkBrutto += stkBrutto;
    totals.stkNetto += stkNetto;
    totals.orders += orders;
    totals.returStk += returQty;
    totals.returKr += refundedAmount;
    totals.returOrdre += (shopData.returOrderCount || 0);
    totals.fragt += shipping;
    totals.rabat += rabat;
    totals.cancelled += cancelled;
  });

  // Total række
  const totalReturOrdrePct = totals.orders > 0 ? (totals.returOrdre / totals.orders) : 0;
  const totalFragtPct = totals.brutto > 0 ? (totals.fragt / totals.brutto) : 0;

  rows.push([
    'I alt',
    round2_(totals.brutto),
    round2_(totals.netto),
    totals.stkBrutto,
    totals.stkNetto,
    totals.orders,
    round2_(totals.orders > 0 ? totals.brutto / totals.orders : 0),
    totals.orders > 0 ? toFixed1_(totals.stkBrutto / totals.orders) : '0',
    round2_(totals.stkBrutto > 0 ? totals.brutto / totals.stkBrutto : 0),
    pctStr_(totals.stkBrutto > 0 ? (totals.returStk / totals.stkBrutto) : 0),
    pctStr_(totals.brutto > 0 ? (totals.returKr / totals.brutto) : 0),
    pctStr_(totalReturOrdrePct),
    round2_(totals.fragt),
    pctStr_(totalFragtPct),
    round2_(totals.rabat),
    totals.cancelled
  ]);

  if (rows.length > 0) {
    sheet.getRange(5, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(5 + rows.length - 1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#F0F8FF');
    sheet.autoResizeColumns(1, rows[0].length);
  }
}

function getDashboardSelectedDates_V2() {
  const sheet = getOrCreateSheet('Dashboard_2_0');

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
    const s = new Date(startVal.getTime());
    const e = new Date(endVal.getTime());
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }

  // Fallback til sidste 30 dage
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  sheet.getRange('B1').setValue(startDate);
  sheet.getRange('B2').setValue(endDate);
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');
  return { startDate, endDate };
}

// V2 versions of analytics functions (stubs for now - use production versions)
/**
 * ⚡ V2: Generate Style Color Analytics (ULTRA-FAST using pre-aggregated data)
 * Bruger daily_sku_transactions tabel - 10-15x hurtigere end V1
 */
function generateStyleColorAnalytics_V2() {
  try {
    console.log('⚡ V2: Starter Color Analytics opdatering (pre-aggregation)...');

    // Læs datoer fra Color_Analytics_2_0 arket (B1/B2). Fallback: sidste 90 dage
    const { startDate, endDate } = getColorAnalyticsSelectedDates_V2();

    console.log(`⚡ V2: Henter Color Analytics for ${formatDate(startDate)} til ${formatDate(endDate)}`);

    // Call V2 API endpoint (color-analytics-v2)
    const response = makeApiRequest(`${CONFIG.API_BASE}/color-analytics-v2`, {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      type: 'color-analytics'
    });

    // API returns array of arrays directly in 'data' field
    const rows = response.data || [];

    if (!response.success || !rows || rows.length === 0) {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
      const sheet = getOrCreateSheet('Color_Analytics_2_0');

      // Clear data area from row 4
      if (sheet.getLastRow() >= 4) {
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow >= 4 && lastCol > 0) {
          sheet.getRange(4, 1, lastRow - 4 + 1, lastCol).clear();
        }
      }

      sheet.getRange('A4').setValue(`Ingen data for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
      sheet.getRange('A4').setFontStyle('italic').setFontColor('#666666');
      return;
    }

    // Render data starting from row 4
    renderColorAnalytics_V2(rows, startDate, endDate);
    console.log(`✅ V2: Color Analytics opdateret (${rows.length} farver)`);

  } catch (error) {
    console.error(`💥 V2 Color Analytics fejl: ${error.message}`);
    throw error;
  }
}

function renderColorAnalytics_V2(rows, startDate, endDate) {
  const sheet = getOrCreateSheet('Color_Analytics_2_0');

  // Sæt dato inputs i toppen (A1/A2)
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

  // Ryd alt under række 4
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  // Headers - row 4 (20 columns)
  const headers = [
    'Program',
    'Produkt',
    'Farve',
    'Artikelnummer',
    'Sæson',
    'Køn',
    'Beregnet købt',
    'Solgt',
    'Retur',
    'Lager',
    'Varemodtaget',
    'Difference',
    'Solgt % af købt',
    'Retur % af solgt',
    'Kostpris',
    'DB',
    'Omsætning kr',
    'Status',
    'Tags',
    'Vejl. Pris'
  ];

  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold').setBackground('#E3F2FD');

  // Data rows - starting from row 5
  if (rows.length > 0 && rows[0] && rows[0].length > 0) {
    // Write in batches to avoid timeout (500 rows at a time)
    const BATCH_SIZE = 500;
    const totalRows = rows.length;
    const numCols = rows[0].length;

    console.log(`📝 Skriver ${totalRows} rækker i batches af ${BATCH_SIZE}...`);

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalRows);
      const batchRows = rows.slice(i, batchEnd);
      const startRow = 5 + i;

      sheet.getRange(startRow, 1, batchRows.length, numCols).setValues(batchRows);
      console.log(`  ✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}: Rækker ${i+1}-${batchEnd} skrevet`);

      // Small delay between batches to avoid rate limits
      if (batchEnd < totalRows) {
        Utilities.sleep(100);
      }
    }

    console.log(`🎨 Formaterer kolonner...`);

    // Format in larger batches (1000 rows at a time) - much faster than per-row
    const FORMAT_BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += FORMAT_BATCH_SIZE) {
      const batchEnd = Math.min(i + FORMAT_BATCH_SIZE, rows.length);
      const batchSize = batchEnd - i;
      const startRow = 5 + i;

      // Format Artikelnummer (column D = 4) as plain text
      sheet.getRange(startRow, 4, batchSize, 1).setNumberFormat('@');

      // Format quantity columns as integers
      sheet.getRange(startRow, 7, batchSize, 1).setNumberFormat('#,##0'); // Beregnet købt (G)
      sheet.getRange(startRow, 8, batchSize, 1).setNumberFormat('#,##0'); // Solgt (H)
      sheet.getRange(startRow, 9, batchSize, 1).setNumberFormat('#,##0'); // Retur (I)
      sheet.getRange(startRow, 10, batchSize, 1).setNumberFormat('#,##0'); // Lager (J)
      sheet.getRange(startRow, 11, batchSize, 1).setNumberFormat('#,##0'); // Varemodtaget (K)
      sheet.getRange(startRow, 12, batchSize, 1).setNumberFormat('#,##0'); // Difference (L)

      // Format percentage columns
      sheet.getRange(startRow, 13, batchSize, 1).setNumberFormat('0.00"%"'); // Solgt % af købt (M)
      sheet.getRange(startRow, 14, batchSize, 1).setNumberFormat('0.00"%"'); // Retur % af solgt (N)
      sheet.getRange(startRow, 16, batchSize, 1).setNumberFormat('0.00"%"'); // DB % (P)

      // Format currency columns
      sheet.getRange(startRow, 15, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Kostpris (O)
      sheet.getRange(startRow, 17, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Omsætning kr (Q)
      sheet.getRange(startRow, 20, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Vejl. Pris (T)
    }
    console.log(`  ✅ Formatering færdig`);
  }

  // Skip auto-resize for large datasets (causes timeout)
  // sheet.autoResizeColumns(1, headers.length);
  console.log(`✅ Color Analytics rendering færdig - kolonnebredde ikke auto-justeret (for mange rækker)`);
}

function getColorAnalyticsSelectedDates_V2() {
  const sheet = getOrCreateSheet('Color_Analytics_2_0');

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
    const s = new Date(startVal.getTime());
    const e = new Date(endVal.getTime());
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }

  // Fallback til sidste 90 dage
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  sheet.getRange('B1').setValue(startDate);
  sheet.getRange('B2').setValue(endDate);
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');
  return { startDate, endDate };
}

function generateStyleSKUAnalytics_V2() {
  try {
    console.log('🚀 V2: Starter SKU Analytics opdatering...');

    // Hent dato range fra sheet (SKU_Analytics_2_0)
    const { startDate, endDate } = getSKUAnalyticsSelectedDates_V2();

    if (!startDate || !endDate) {
      throw new Error('Mangler start/slut dato');
    }

    // Call V2 API endpoint (sku-analytics-v2)
    const response = makeApiRequest(`${CONFIG.API_BASE}/sku-analytics-v2`, {
      startDate: formatDateWithTime(startDate, false),
      endDate: formatDateWithTime(endDate, true),
      type: 'sku-analytics'
    });

    // API returns array of arrays directly in 'data' field
    const rows = response.data || [];

    if (!response.success || !rows || rows.length === 0) {
      console.log(`⚠️ Ingen data fundet for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
      const sheet = getOrCreateSheet('SKU_Analytics_2_0');

      // Clear data area from row 4
      if (sheet.getLastRow() >= 4) {
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow >= 4 && lastCol > 0) {
          sheet.getRange(4, 1, lastRow - 4 + 1, lastCol).clear();
        }
      }

      sheet.getRange('A4').setValue(`Ingen data for perioden ${formatDate(startDate)} til ${formatDate(endDate)}`);
      sheet.getRange('A4').setFontStyle('italic').setFontColor('#666666');
      return;
    }

    // Render data starting from row 4
    renderSKUAnalytics_V2(rows, startDate, endDate);
    console.log(`✅ V2: SKU Analytics opdateret (${rows.length} SKUs)`);

  } catch (error) {
    console.error(`💥 V2 SKU Analytics fejl: ${error.message}`);
    throw error;
  }
}

function renderSKUAnalytics_V2(rows, startDate, endDate) {
  const sheet = getOrCreateSheet('SKU_Analytics_2_0');

  // Sæt dato inputs i toppen (A1/A2)
  sheet.getRange('A1').setValue('Startdato:');
  sheet.getRange('A2').setValue('Slutdato:');
  sheet.getRange('A1:A2').setFontWeight('bold');
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');

  // Ryd alt under række 4
  if (sheet.getLastRow() >= 4) {
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.getRange(4, 1, lastRow - 3, lastCol).clear();
  }

  // Headers - row 4 (21 columns - includes Størrelse)
  const headers = [
    'Program',
    'Produkt',
    'Farve',
    'Artikelnummer',
    'Sæson',
    'Køn',
    'Størrelse',
    'Beregnet købt',
    'Solgt',
    'Retur',
    'Lager',
    'Varemodtaget',
    'Difference',
    'Solgt % af købt',
    'Retur % af solgt',
    'Kostpris',
    'DB',
    'Omsætning kr',
    'Status',
    'Tags',
    'Vejl. Pris'
  ];

  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold').setBackground('#E3F2FD');

  // Data rows - starting from row 5
  if (rows.length > 0 && rows[0] && rows[0].length > 0) {
    // Write in batches to avoid timeout (500 rows at a time)
    const BATCH_SIZE = 500;
    const totalRows = rows.length;
    const numCols = rows[0].length;

    console.log(`📝 Skriver ${totalRows} rækker i batches af ${BATCH_SIZE}...`);

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalRows);
      const batchRows = rows.slice(i, batchEnd);
      const startRow = 5 + i;

      sheet.getRange(startRow, 1, batchRows.length, numCols).setValues(batchRows);
      console.log(`  ✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}: Rækker ${i+1}-${batchEnd} skrevet`);

      // Small delay between batches to avoid rate limits
      if (batchEnd < totalRows) {
        Utilities.sleep(100);
      }
    }

    console.log(`🎨 Formaterer kolonner...`);

    // Format in larger batches (1000 rows at a time) - much faster than per-row
    const FORMAT_BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += FORMAT_BATCH_SIZE) {
      const batchEnd = Math.min(i + FORMAT_BATCH_SIZE, rows.length);
      const batchSize = batchEnd - i;
      const startRow = 5 + i;

      // Format Artikelnummer (column D = 4) as plain text
      sheet.getRange(startRow, 4, batchSize, 1).setNumberFormat('@');

      // Format quantity columns as integers
      sheet.getRange(startRow, 8, batchSize, 1).setNumberFormat('#,##0'); // Beregnet købt (H)
      sheet.getRange(startRow, 9, batchSize, 1).setNumberFormat('#,##0'); // Solgt (I)
      sheet.getRange(startRow, 10, batchSize, 1).setNumberFormat('#,##0'); // Retur (J)
      sheet.getRange(startRow, 11, batchSize, 1).setNumberFormat('#,##0'); // Lager (K)
      sheet.getRange(startRow, 12, batchSize, 1).setNumberFormat('#,##0'); // Varemodtaget (L)
      sheet.getRange(startRow, 13, batchSize, 1).setNumberFormat('#,##0'); // Difference (M)

      // Format percentage columns
      sheet.getRange(startRow, 14, batchSize, 1).setNumberFormat('0.00"%"'); // Solgt % af købt (N)
      sheet.getRange(startRow, 15, batchSize, 1).setNumberFormat('0.00"%"'); // Retur % af solgt (O)
      sheet.getRange(startRow, 17, batchSize, 1).setNumberFormat('0.00"%"'); // DB % (Q)

      // Format currency columns
      sheet.getRange(startRow, 16, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Kostpris (P)
      sheet.getRange(startRow, 18, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Omsætning kr (R)
      sheet.getRange(startRow, 21, batchSize, 1).setNumberFormat('#,##0.00 "kr"'); // Vejl. Pris (U)
    }
    console.log(`  ✅ Formatering færdig`);
  }

  // Skip auto-resize for large datasets (causes timeout)
  // sheet.autoResizeColumns(1, headers.length);
  console.log(`✅ SKU Analytics rendering færdig - kolonnebredde ikke auto-justeret (for mange rækker)`);
}

function getSKUAnalyticsSelectedDates_V2() {
  const sheet = getOrCreateSheet('SKU_Analytics_2_0');

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
    const s = new Date(startVal.getTime());
    const e = new Date(endVal.getTime());
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }

  // Fallback til sidste 90 dage
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  sheet.getRange('B1').setValue(startDate);
  sheet.getRange('B2').setValue(endDate);
  sheet.getRange('B1:B2').setNumberFormat('dd/MM/yyyy');
  return { startDate, endDate };
}

function generateStyleNumberAnalytics_V2() {
  SpreadsheetApp.getUi().alert('V2 Analytics', 'Style Number Analytics V2 bruger samme endpoint som V1. Brug V1 versionen.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function generateDeliveryAnalytics_V2() {
  SpreadsheetApp.getUi().alert('V2 Analytics', 'Delivery Analytics V2 bruger samme endpoint som V1. Brug V1 versionen.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function testConnection_V2() {
  try {
    console.log('🔍 Tester V2 API forbindelse...');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);

    const data = makeApiRequest(`${CONFIG.API_BASE}/analytics-v2`, {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      type: 'dashboard-sku'
    });

    if (data.success) {
      console.log(`✅ V2 API Forbindelse OK: ${data.data ? data.data.length : 0} shops`);
      SpreadsheetApp.getUi().alert('V2 API Forbindelse OK', `Pre-aggregation API fungerer korrekt.`, SpreadsheetApp.getUi().ButtonSet.OK);
    } else {
      throw new Error('V2 API returnerede fejl');
    }
  } catch (error) {
    console.error(`💥 V2 API fejl: ${error.message}`);
    SpreadsheetApp.getUi().alert('V2 API Fejl', `Kunne ikke forbinde til pre-aggregation API: ${error.message}`, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
