// === MetadataManager.gs ===
// 🏷️ Optimeret metadata management med incremental updates

/**
 * SMART metadata hentning - kun opdater det der har ændret sig
 */
function getCachedProductMetadata() {
  const metadataSheet = getOrCreateSheet_('_PRODUCT_METADATA');
  const lastUpdate = PropertiesService.getScriptProperties().getProperty('metadata_last_update');
  const maxAge = 24 * 60 * 60 * 1000; // 24 timer
  
  // Tjek om vi har data og det ikke er for gammelt
  if (metadataSheet.getLastRow() > 1 && lastUpdate) {
    const age = new Date() - new Date(lastUpdate);
    if (age < maxAge) {
      Logger.log(`✅ Bruger cached metadata (${Math.round(age / (60 * 60 * 1000))}h gammelt)`);
      return loadMetadataFromCache(metadataSheet);
    }
  }
  
  // Incremental update hvis muligt
  if (metadataSheet.getLastRow() > 1 && lastUpdate) {
    Logger.log('🔄 Kører incremental metadata update...');
    return refreshMetadataIncremental(new Date(lastUpdate));
  }
  
  // Full refresh hvis ingen data
  Logger.log('🔄 Kører fuld metadata refresh...');
  return refreshProductMetadataOptimized();
}

/**
 * INCREMENTAL metadata update - kun produkter ændret siden sidst
 */
function refreshMetadataIncremental(sinceDate) {
  Logger.log(`🔄 Henter metadata ændringer siden ${sinceDate.toISOString()}`);
  const startTime = new Date();
  
  try {
    const existingMetadata = loadMetadataFromCache(getOrCreateSheet_('_PRODUCT_METADATA'));
    const danskShop = SHOPS[0];
    const client = new GraphQLClient(danskShop);
    
    // Query kun for opdaterede produkter
    const updatedVariants = fetchUpdatedVariants(client, sinceDate);
    Logger.log(`📦 Fandt ${updatedVariants.length} opdaterede variants`);
    
    // Merge med eksisterende data
    let updateCount = 0;
    updatedVariants.forEach(variant => {
      if (variant.sku) {
        existingMetadata[variant.sku] = variant;
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      // Gem opdateret metadata
      saveMetadataToCache(existingMetadata);
      Logger.log(`✅ Opdateret ${updateCount} metadata entries`);
    }
    
    const elapsed = ((new Date() - startTime) / 1000).toFixed(2);
    Logger.log(`✅ Incremental metadata update færdig på ${elapsed}s`);
    
    return existingMetadata;
    
  } catch (error) {
    Logger.log(`❌ Incremental update fejl: ${error.message}`);
    Logger.log('🔄 Falder tilbage til fuld refresh');
    return refreshProductMetadataOptimized();
  }
}

/**
 * Hent kun opdaterede variants siden en given dato
 */
function fetchUpdatedVariants(client, sinceDate) {
  const variants = [];
  let cursor = null;
  const isoDate = sinceDate.toISOString();
  
  const query = (cursorVal) => `
    query {
      productVariants(first: 250${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "updated_at:>'${isoDate}'") {
        edges {
          cursor
          node {
            id
            sku
            price
            compareAtPrice
            inventoryQuantity
            updatedAt
            product {
              title
              status
              tags
              updatedAt
              metafields(first: 10, namespace: "custom") {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
            title
            inventoryItem {
              unitCost {
                amount
              }
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;
  
  try {
    while (true) {
      const data = client.query(query(cursor));
      
      // Tjek om data er validt
      if (!data) {
        Logger.log(`❌ Tom respons fra GraphQL query for opdaterede variants`);
        break;
      }
      
      if (!data.productVariants) {
        Logger.log(`❌ Manglende productVariants i respons: ${JSON.stringify(data)}`);
        break;
      }
      
      const edges = data.productVariants.edges || [];
      
      edges.forEach(edge => {
        if (!edge || !edge.node) {
          Logger.log(`⚠️ Ugyldig edge i opdaterede variants`);
          return;
        }
        
        const variant = edge.node;
        const sku = variant.sku?.trim().toUpperCase();
        if (!sku) return;
        
        // Parse variant til vores format
        const parsed = parseVariantToMetadata(variant);
        variants.push(parsed);
      });
      
      if (!data.productVariants.pageInfo || !data.productVariants.pageInfo.hasNextPage) break;
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      if (!cursor) {
        Logger.log(`⚠️ Ingen cursor for opdaterede variants - stopper`);
        break;
      }
      
      // Rate limit
      Utilities.sleep(250);
    }
  } catch (error) {
    Logger.log(`❌ Fejl ved hentning af opdaterede variants: ${error.message}`);
    Logger.log(`❌ Error stack: ${error.stack}`);
  }
  
  return variants;
}

/**
 * OPTIMERET full refresh - med bedre batching
 */
function refreshProductMetadataOptimized() {
  Logger.log('🇩🇰 Henter metadata fra dansk shop (optimeret)...');
  const startTime = new Date();
  
  try {
    const danskShop = SHOPS[0];
    Logger.log(`🏪 Shop: ${danskShop.domain}`);
    
    // Tjek token før vi fortsætter
    const token = getToken(danskShop.domain);
    if (!token) {
      throw new Error(`❌ Ingen token fundet for ${danskShop.domain}`);
    }
    Logger.log(`🔑 Token fundet for ${danskShop.domain}: ${token.substring(0, 10)}...`);
    
    const client = new GraphQLClient(danskShop);
    Logger.log('✅ GraphQL client oprettet');
    
    // Hent i parallelle batches
    const variants = fetchAllVariantsOptimized(client);
    
    // Konverter til metadata format
    const metadata = {};
    variants.forEach(variant => {
      if (variant.sku) {
        metadata[variant.sku] = variant;
      }
    });
    
    // Gem til cache
    saveMetadataToCache(metadata);
    
    const elapsed = ((new Date() - startTime) / 1000).toFixed(2);
    Logger.log(`✅ Metadata refresh færdig: ${Object.keys(metadata).length} SKUs på ${elapsed}s`);
    
    return metadata;
    
  } catch (error) {
    Logger.log(`❌ Metadata refresh fejl: ${error.message}`);
    throw error;
  }
}

/**
 * Hent alle variants med optimeret batching
 */
function fetchAllVariantsOptimized(client) {
  Logger.log('🔄 Starter fetchAllVariantsOptimized...');
  const allVariants = [];
  let cursor = null;
  let pageCount = 0;
  
  // Større batch size for færre API kald
  const batchSize = 250; // Max tilladt
  Logger.log(`📊 Batch size: ${batchSize}`);
  
  const query = (cursorVal) => `
    query {
      productVariants(first: ${batchSize}${cursorVal ? `, after: "${cursorVal}"` : ""}) {
        edges {
          cursor
          node {
            id
            sku
            price
            compareAtPrice
            inventoryQuantity
            product {
              title
              status
              tags
              metafields(first: 20, namespace: "custom") {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
            title
            inventoryItem {
              unitCost {
                amount
              }
            }
            metafields(first: 20, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;
  
  try {
    while (true) {
      Logger.log(`🚀 Kører GraphQL query for side ${pageCount + 1}${cursor ? ` med cursor: ${cursor.substring(0, 20)}...` : ' (første side)'}`);
      const data = client.query(query(cursor));
      Logger.log(`📨 Modtaget respons: ${data ? 'OK' : 'TOM'}`);
      
      // Tjek om data er validt
      if (!data) {
        Logger.log(`❌ Tom respons fra GraphQL query på side ${pageCount + 1}`);
        break;
      }
      
      if (!data.productVariants) {
        Logger.log(`❌ Manglende productVariants i respons: ${JSON.stringify(data)}`);
        break;
      }
      
      const edges = data.productVariants.edges || [];
      
      pageCount++;
      Logger.log(`📦 Page ${pageCount}: ${edges.length} variants`);
      
      edges.forEach(edge => {
        if (!edge || !edge.node) {
          Logger.log(`⚠️ Ugyldig edge på side ${pageCount}`);
          return;
        }
        
        const variant = edge.node;
        const sku = variant.sku?.trim().toUpperCase();
        if (!sku) return;
        
        const parsed = parseVariantToMetadata(variant);
        allVariants.push(parsed);
      });
      
      if (!data.productVariants.pageInfo || !data.productVariants.pageInfo.hasNextPage) break;
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      if (!cursor) {
        Logger.log(`⚠️ Ingen cursor på side ${pageCount} - stopper`);
        break;
      }
      
      // Rate limit med progressiv delay
      const delay = pageCount > 20 ? 500 : 250;
      Utilities.sleep(delay);
    }
  } catch (error) {
    Logger.log(`❌ Fejl ved hentning af alle variants: ${error.message}`);
    Logger.log(`❌ Error stack: ${error.stack}`);
  }
  
  return allVariants;
}

/**
 * Parse variant til vores metadata format
 */
function parseVariantToMetadata(variant) {
  // Kombiner product og variant metafields
  const metadata = {};
  
  // Product metafields
  variant.product.metafields.edges.forEach(({ node }) => {
    metadata[node.key] = node.value;
  });
  
  // Variant metafields (overskriver product hvis der er overlap)
  variant.metafields.edges.forEach(({ node }) => {
    metadata[node.key] = node.value;
  });
  
  // Hent cost fra inventory item
  const cost = variant.inventoryItem?.unitCost?.amount || 0;
  
  // Hent price og compareAtPrice
  const price = parseFloat(variant.price) || 0;
  const compareAtPrice = parseFloat(variant.compareAtPrice) || 0;
  
  return {
    sku: variant.sku,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    status: variant.product.status,
    cost: parseFloat(cost),
    inventory: Math.max(0, variant.inventoryQuantity || 0),
    metadata: metadata,
    program: metadata.program || extractFromTitle(variant.product.title, 'program'),
    produkt: metadata.produkt || extractFromTitle(variant.product.title, 'produkt'),
    farve: metadata.farve || extractFromTitle(variant.title, 'farve'),
    artikelnummer: metadata.artikelnummer || variant.sku,
    stamvarenummer: metadata.stamvarenummer || metadata['custom.stamvarenummer'] || '',
    season: metadata.season || '',
    gender: metadata.gender || '',
    størrelse: metadata.størrelse || extractFromTitle(variant.title, 'størrelse'),
    varemodtaget: parseInt(metadata.varemodtaget) || 0,
    kostpris: parseFloat(cost),
    tags: (variant.product.tags || []).join(', '),
    price: price,
    compareAtPrice: compareAtPrice
  };
}

/**
 * Load metadata fra cache sheet
 */
function loadMetadataFromCache(sheet) {
  const metadata = {};
  
  if (sheet.getLastRow() <= 1) return metadata;
  
  try {
    const data = sheet.getDataRange().getValues().slice(1);
    let stamvarenummerCount = 0;
    
    data.forEach((row, index) => {
      const sku = row[0];
      if (sku) {
        metadata[sku] = {
          sku: row[0],
          productTitle: row[1],
          variantTitle: row[2],
          status: row[3],
          cost: parseFloat(row[4]) || 0,
          program: row[5],
          produkt: row[6],
          farve: row[7],
          artikelnummer: row[8],
          season: row[9],
          gender: row[10],
          størrelse: row[11],
          varemodtaget: parseInt(row[12]) || 0,
          kostpris: parseFloat(row[13]) || 0,
          stamvarenummer: row[14] || '',
          lastUpdate: row[15], // LastUpdate kolonne (kolonne P)
          tags: row[16] || '', // Tags kolonne (kolonne Q)
          price: parseFloat(row[17]) || 0, // Price kolonne (kolonne R)
          compareAtPrice: parseFloat(row[18]) || 0 // CompareAtPrice kolonne (kolonne S)
        };
        
        // Debug: Tæl stamvarenumre
        if (row[14] && row[14] !== '') {
          stamvarenummerCount++;
        }
      }
    });
    
    Logger.log(`🔍 Metadata loaded: ${Object.keys(metadata).length} SKUs, ${stamvarenummerCount} har stamvarenummer`);
  } catch (e) {
    Logger.log(`⚠️ Metadata cache load fejl: ${e.message}`);
  }
  
  return metadata;
}

/**
 * Save metadata til cache sheet
 */
function saveMetadataToCache(metadata) {
  try {
    const sheet = getOrCreateSheet_('_PRODUCT_METADATA');
    sheet.clear();
    
    // Headers - NY: Tilføjet Price og CompareAtPrice
    sheet.appendRow([
      'SKU', 'ProductTitle', 'VariantTitle', 'Status', 'Cost',
      'Program', 'Produkt', 'Farve', 'Artikelnummer', 'Season',
      'Gender', 'Størrelse', 'Varemodtaget', 'Kostpris', 'Stamvarenummer', 'LastUpdate', 'Tags', 'Price', 'CompareAtPrice'
    ]);
    
    // Data rows - NY: Tilføjet price og compareAtPrice kolonne
    const rows = Object.values(metadata).map(item => [
      item.sku,
      item.productTitle,
      item.variantTitle,
      item.status,
      item.cost,
      item.program,
      item.produkt,
      item.farve,
      item.artikelnummer,
      item.season,
      item.gender,
      item.størrelse,
      item.varemodtaget,
      item.kostpris,
      item.stamvarenummer || '', // Stamvarenummer kolonne
      new Date(),
      item.tags || '', // Tags kolonne (kolonne Q)
      item.price || 0, // Price kolonne (kolonne R)
      item.compareAtPrice || 0 // CompareAtPrice kolonne (kolonne S)
    ]);
    
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, 19).setValues(rows);
    }
    
    // Update timestamp
    PropertiesService.getScriptProperties().setProperty('metadata_last_update', new Date().toISOString());
    
    Logger.log(`💾 Metadata cached: ${rows.length} SKUs med stamvarenummer og tags`);
    
  } catch (e) {
    Logger.log(`❌ Metadata cache save fejl: ${e.message}`);
  }
}

/**
 * Extract info fra titel hvis metafields mangler
 */
function extractFromTitle(title, field) {
  if (!title) return '';
  
  const patterns = {
    program: /^([A-Z]+)/,
    produkt: /([A-Z]+\s+[A-Z]+)/,
    farve: /\b(BLACK|WHITE|BLUE|RED|GREEN|YELLOW|PINK|GREY|GRAY|NAVY|BROWN)\b/i,
    størrelse: /\b(XS|S|M|L|XL|XXL|\d+)\b/
  };
  
  const pattern = patterns[field];
  if (pattern) {
    const match = title.match(pattern);
    return match ? match[1] : '';
  }
  
  return '';
}

/**
 * Wrapper funktion for kompatibilitet med pre-warming
 */
function refreshProductMetadataCache() {
  Logger.log('🔄 Metadata cache er forældet - opdaterer...');
  return refreshProductMetadataOptimized();
}

/**
 * Pre-warm metadata cache
 */
function preWarmMetadataCache() {
  Logger.log('🏷️ Pre-warming metadata cache...');
  try {
    const metadata = getCachedProductMetadata();
    Logger.log(`✅ Metadata pre-warmed: ${Object.keys(metadata).length} SKUs`);
    return metadata;
  } catch (error) {
    Logger.log(`❌ Metadata pre-warm fejl: ${error.message}`);
    throw error;
  }
}

/**
 * 🔍 DEBUG: Tjek metafields for specifikt SKU
 */
function debugSkuMetafields(targetSku) {
  Logger.log(`🔍 === DEBUG METAFIELDS FOR SKU: ${targetSku} ===`);
  
  try {
    const danskShop = SHOPS[0];
    const client = new GraphQLClient(danskShop);
    
    // Søg efter specifikt SKU
    const query = `
      query {
        productVariants(first: 250, query: "sku:${targetSku}") {
          edges {
            node {
              sku
              price
              compareAtPrice
              product {
                title
                metafields(first: 20, namespace: "custom") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
              title
              metafields(first: 20, namespace: "custom") {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = client.query(query);
    const variants = data.productVariants.edges || [];
    
    if (variants.length === 0) {
      Logger.log(`❌ SKU ${targetSku} ikke fundet!`);
      return;
    }
    
    const variant = variants[0].node;
    Logger.log(`✅ Fundet SKU: ${variant.sku}`);
    Logger.log(`📦 Product: ${variant.product.title}`);
    Logger.log(`📦 Variant: ${variant.title}`);
    Logger.log(`💰 Price: ${variant.price || 'IKKE FUNDET'}`);
    Logger.log(`💸 CompareAtPrice: ${variant.compareAtPrice || 'IKKE FUNDET'}`);
    
    Logger.log('\n📋 PRODUCT METAFIELDS:');
    const productMetafields = {};
    variant.product.metafields.edges.forEach(({ node }) => {
      productMetafields[node.key] = node.value;
      Logger.log(`   ${node.key}: ${node.value}`);
    });
    
    Logger.log('\n📋 VARIANT METAFIELDS:');
    const variantMetafields = {};
    variant.metafields.edges.forEach(({ node }) => {
      variantMetafields[node.key] = node.value;
      Logger.log(`   ${node.key}: ${node.value}`);
    });
    
    Logger.log('\n🔍 VAREMODTAGET ANALYSE:');
    const productVaremodtaget = productMetafields.varemodtaget;
    const variantVaremodtaget = variantMetafields.varemodtaget;
    
    Logger.log(`   Product varemodtaget: ${productVaremodtaget || 'IKKE FUNDET'}`);
    Logger.log(`   Variant varemodtaget: ${variantVaremodtaget || 'IKKE FUNDET'}`);
    
    // Simuler parsing logik
    const finalMetadata = { ...productMetafields };
    Object.keys(variantMetafields).forEach(key => {
      finalMetadata[key] = variantMetafields[key];
    });
    
    const finalVaremodtaget = parseInt(finalMetadata.varemodtaget) || 0;
    Logger.log(`   Final varemodtaget værdi: ${finalVaremodtaget}`);
    
    if (variantVaremodtaget && variantVaremodtaget !== productVaremodtaget) {
      Logger.log(`✅ Variant metafield OVERSKRIVER product metafield`);
    } else if (variantVaremodtaget) {
      Logger.log(`ℹ️ Variant og product har samme varemodtaget værdi`);
    } else if (productVaremodtaget) {
      Logger.log(`⚠️ Kun product har varemodtaget - variant mangler metafield`);
    } else {
      Logger.log(`❌ Hverken product eller variant har varemodtaget metafield`);
    }
    
  } catch (error) {
    Logger.log(`❌ Debug fejl: ${error.message}`);
  }
}

/**
 * 📅 MANUEL CACHE BACKFILL: Hent manglende SKU data for specifik periode
 */
function manualBackfillSkuCache(startDateStr, endDateStr) {
  Logger.log(`📅 === MANUEL SKU CACHE BACKFILL ===`);
  Logger.log(`🗓️ Periode: ${startDateStr} til ${endDateStr}`);
  
  try {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Ugyldige datoer - brug format: YYYY-MM-DD');
    }
    
    Logger.log(`📊 Henter SKU data for ${Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000))} dage`);
    
    const skuSheet = getOrCreateSheet_('_SKU_CACHE');
    const beforeCount = skuSheet.getLastRow() - 1; // Minus headers
    
    let totalAdded = 0;
    
    // Hent eksisterende nøgler for deduplicering
    const existingKeys = new Set();
    if (skuSheet.getLastRow() > 1) {
      const existingData = skuSheet.getDataRange().getValues().slice(1);
      existingData.forEach(row => {
        const key = `${row[0]}|${row[1]}|${row[4]}`; // shop|orderId|sku
        existingKeys.add(key);
      });
    }
    
    Logger.log(`📋 Eksisterende SKU nøgler: ${existingKeys.size}`);
    
    // Process hver shop
    for (const shop of SHOPS) {
      Logger.log(`\n🏪 Processing ${shop.domain}...`);
      
      try {
        const client = new ShopifyAPIClient(shop);
        
        // Hent orders for perioden
        const orders = client.fetchOrdersUpdated(startDate, endDate);
        Logger.log(`📦 Fundet ${orders.length} orders for ${shop.domain}`);
        
        if (orders.length === 0) continue;
        
        // Udtræk SKU data fra orders
        const skuRows = [];
        
        orders.forEach(order => {
          if (!order.lineItems || order.lineItems.length === 0) return;
          
          order.lineItems.forEach(lineItem => {
            const sku = lineItem.sku || 'NO_SKU';
            const key = `${shop.domain}|${order.id}|${sku}`;
            
            // Skip hvis vi allerede har denne SKU
            if (existingKeys.has(key)) return;
            
            // Beregn pris i DKK
            const exchangeRate = getExchangeRateForShop(shop);
            const priceDKK = (parseFloat(lineItem.price) || 0) * exchangeRate;
            
            skuRows.push([
              shop.domain,                    // shop
              order.id,                      // orderId
              order.createdAt.slice(0, 10),  // createdAt (dato)
              order.shippingAddress?.country || 'Unknown', // country
              sku,                           // sku
              lineItem.productTitle || 'Unknown Product', // productTitle
              lineItem.variantTitle || '',   // variantTitle
              parseInt(lineItem.quantity) || 0, // quantity
              parseInt(lineItem.refundedQuantity) || 0, // refundedQty
              priceDKK,                      // priceDKK
              order.refundedAt || ''         // refundDate
            ]);
          });
        });
        
        Logger.log(`📦 Extracteret ${skuRows.length} SKU entries for ${shop.domain}`);
        
        // Tilføj til cache
        if (skuRows.length > 0) {
          const startRow = skuSheet.getLastRow() + 1;
          skuSheet.getRange(startRow, 1, skuRows.length, skuRows[0].length).setValues(skuRows);
          SpreadsheetApp.flush();
          
          totalAdded += skuRows.length;
          Logger.log(`✅ Tilføjet ${skuRows.length} SKU entries til cache`);
          
          // Opdater existing keys for næste shop
          skuRows.forEach(row => {
            const key = `${row[0]}|${row[1]}|${row[4]}`;
            existingKeys.add(key);
          });
        }
        
        // Lille pause mellem shops
        Utilities.sleep(1000);
        
      } catch (shopError) {
        Logger.log(`❌ Fejl for ${shop.domain}: ${shopError.message}`);
      }
    }
    
    const afterCount = skuSheet.getLastRow() - 1;
    
    Logger.log(`\n🎉 === BACKFILL RESULTAT ===`);
    Logger.log(`📊 Før: ${beforeCount} SKU entries`);
    Logger.log(`📊 Efter: ${afterCount} SKU entries`);
    Logger.log(`➕ Tilføjet: ${totalAdded} nye SKU entries`);
    Logger.log(`📅 Periode: ${startDateStr} til ${endDateStr}`);
    
    // Fjern eventuelle duplikater
    Logger.log(`🧹 Fjerner duplikater...`);
    removeDuplicatesFromSheetSmart('_SKU_CACHE');
    
    const finalCount = skuSheet.getLastRow() - 1;
    Logger.log(`✅ Final count efter dedupe: ${finalCount} SKU entries`);
    
  } catch (error) {
    Logger.log(`❌ Backfill fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 🔧 HURTIG BACKFILL: Kun for manglende periode (28. maj - 2. juni)
 */
function quickBackfillMissingPeriod() {
  Logger.log('🔧 Hurtig backfill af manglende periode...');
  manualBackfillSkuCache('2025-05-28', '2025-06-02');
}

/**
 * 🚨 DISASTER RECOVERY: Genopbyg ALLE cache sheets fra bunden
 */
function rebuildAllCachesFromScratch() {
  Logger.log('🚨 === DISASTER RECOVERY: GENOPBYGGER ALLE CACHES ===');
  const startTime = new Date();
  
  try {
    Logger.log('📋 Tjekker hvilke caches der mangler...');
    
    const requiredSheets = [
      '_ORDER_CACHE',
      '_SKU_CACHE', 
      '_FULFILLMENT_CACHE',
      '_INVENTORY_CACHE',
      '_PRODUCT_METADATA'
    ];
    
    const missingSheets = [];
    const emptySheets = [];
    
    requiredSheets.forEach(sheetName => {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (!sheet) {
        missingSheets.push(sheetName);
      } else if (sheet.getLastRow() <= 1) {
        emptySheets.push(sheetName);
      }
    });
    
    Logger.log(`❌ Manglende sheets: ${missingSheets.join(', ') || 'Ingen'}`);
    Logger.log(`📭 Tomme sheets: ${emptySheets.join(', ') || 'Ingen'}`);
    
    const sheetsToRebuild = [...missingSheets, ...emptySheets];
    
    if (sheetsToRebuild.length === 0) {
      Logger.log('✅ Alle cache sheets eksisterer og har data!');
      return;
    }
    
    Logger.log(`🔧 Genopbygger ${sheetsToRebuild.length} cache sheets...`);
    
    // 1. METADATA CACHE (vigtigst først)
    if (sheetsToRebuild.includes('_PRODUCT_METADATA')) {
      Logger.log('\n🏷️ === GENOPBYGGER METADATA CACHE ===');
      PropertiesService.getScriptProperties().deleteProperty('metadata_last_update');
      refreshProductMetadataOptimized();
      Logger.log('✅ Metadata cache genopbygget');
    }
    
    // 2. INVENTORY CACHE  
    if (sheetsToRebuild.includes('_INVENTORY_CACHE')) {
      Logger.log('\n📦 === GENOPBYGGER INVENTORY CACHE ===');
      PropertiesService.getScriptProperties().deleteProperty('inventory_last_update');
      refreshInventorySimple();
      Logger.log('✅ Inventory cache genopbygget');
    }
    
    // 3. HISTORICAL CACHES (orders, skus, fulfillments)
    const historicalSheets = sheetsToRebuild.filter(sheet => 
      ['_ORDER_CACHE', '_SKU_CACHE', '_FULFILLMENT_CACHE'].includes(sheet)
    );
    
    if (historicalSheets.length > 0) {
      Logger.log('\n📊 === GENOPBYGGER HISTORICAL CACHES ===');
      Logger.log(`🗓️ Henter data fra ${formatLocalDate(new Date('2024-09-30'))} til nu`);
      
      // Reset alle timestamps så full fetch kører
      SHOPS.forEach(shop => {
        ['orders', 'skus', 'fulfillments'].forEach(type => {
          PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_${type}_${shop.domain}`);
        });
      });
      
      // Kør full cache rebuild
      runAutomaticCacheUpdate();
      Logger.log('✅ Historical caches genopbygget');
    }
    
    // 4. VALIDER RESULTATER
    Logger.log('\n🔍 === VALIDERER RESULTATER ===');
    const results = {};
    
    requiredSheets.forEach(sheetName => {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (sheet) {
        const rowCount = sheet.getLastRow() - 1; // Minus headers
        results[sheetName] = rowCount;
        Logger.log(`📊 ${sheetName}: ${rowCount} rækker`);
      } else {
        results[sheetName] = 'MANGLER STADIG';
        Logger.log(`❌ ${sheetName}: MANGLER STADIG`);
      }
    });
    
    const elapsed = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    
    Logger.log('\n🎉 === DISASTER RECOVERY COMPLETED ===');
    Logger.log(`⏱️ Total tid: ${elapsed} minutter`);
    Logger.log('📊 Cache status:');
    Object.entries(results).forEach(([sheet, count]) => {
      Logger.log(`   ${sheet}: ${count}`);
    });
    
    // Tjek om alt lykkedes
    const failedSheets = Object.entries(results).filter(([sheet, count]) => 
      count === 'MANGLER STADIG' || count === 0
    );
    
    if (failedSheets.length === 0) {
      Logger.log('✅ ALLE CACHES GENOPBYGGET SUCCESFULDT! 🎉');
    } else {
      Logger.log(`⚠️ ${failedSheets.length} cache(s) fejlede:`);
      failedSheets.forEach(([sheet, count]) => {
        Logger.log(`   ❌ ${sheet}: ${count}`);
      });
    }
    
  } catch (error) {
    Logger.log(`❌ Disaster recovery fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 🏷️ SPECIFIK: Genopbyg kun metadata cache
 */
function rebuildMetadataCache() {
  Logger.log('🏷️ Genopbygger metadata cache...');
  PropertiesService.getScriptProperties().deleteProperty('metadata_last_update');
  return refreshProductMetadataOptimized();
}

/**
 * 📦 SPECIFIK: Genopbyg kun inventory cache  
 */
function rebuildInventoryCache() {
  Logger.log('📦 Genopbygger inventory cache...');
  PropertiesService.getScriptProperties().deleteProperty('inventory_last_update');
  return refreshInventorySimple();
}

/**
 * 📊 SPECIFIK: Genopbyg kun historical caches (orders/skus/fulfillments)
 */
function rebuildHistoricalCaches() {
  Logger.log('📊 Genopbygger historical caches...');
  
  // Reset alle timestamps
  SHOPS.forEach(shop => {
    ['orders', 'skus', 'fulfillments'].forEach(type => {
      PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_${type}_${shop.domain}`);
    });
  });
  
  return runAutomaticCacheUpdate();
}

/**
 * 🎯 QUICK FIXES: Individuelle cache rebuilds
 */
function rebuildOrderCacheOnly() {
  Logger.log('🛒 Genopbygger kun ORDER cache...');
  const sheet = getOrCreateSheet_('_ORDER_CACHE');
  sheet.clear();
  SHOPS.forEach(shop => {
    PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_orders_${shop.domain}`);
  });
  return runAutomaticCacheUpdate();
}

function rebuildSkuCacheOnly() {
  Logger.log('🏷️ Genopbygger kun SKU cache...');
  const sheet = getOrCreateSheet_('_SKU_CACHE');
  sheet.clear();
  SHOPS.forEach(shop => {
    PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_skus_${shop.domain}`);
  });
  return runAutomaticCacheUpdate();
}

function rebuildFulfillmentCacheOnly() {
  Logger.log('🚚 Genopbygger kun FULFILLMENT cache...');
  const sheet = getOrCreateSheet_('_FULFILLMENT_CACHE');
  sheet.clear();
  SHOPS.forEach(shop => {
    PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_fulfillments_${shop.domain}`);
  });
  return runAutomaticCacheUpdate();
}

/**
 * 📅 BACKFILL: Hent alle SKU-data for ordrer opdateret i en given måned
 * month: 1-12 (fx 9 for september), year: 4-cifret (fx 2025)
 * Henter i 7-dages chunks for stabilitet, deduplikerer og skriver i batches.
 */
function backfillSkuCacheUpdatedForMonth(year, month) {
  Logger.log(`🧾 === BACKFILL SKUs (updated_at) for ${year}-${('0' + month).slice(-2)} ===`);
  const sheetName = '_SKU_CACHE';
  const CHUNK_DAYS = 7;

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999); // Sidste dag i måneden

  try {
    const sheet = getOrCreateSheet_(sheetName);

    for (const shop of SHOPS) {
      Logger.log(`\n🏪 ${shop.domain}: Backfill ${formatLocalDate(start)} → ${formatLocalDate(end)} (updated_at)`);

      const client = new ShopifyAPIClient(shop);
      const existingKeys = getExistingKeysOptimized(sheetName, 'skus'); // shop|orderId|sku

      let chunkStart = new Date(start);
      let totalWritten = 0;

      while (chunkStart <= end) {
        let chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + (CHUNK_DAYS - 1));
        if (chunkEnd > end) chunkEnd = new Date(end);

        Logger.log(`🔎 Chunk ${formatLocalDate(chunkStart)} → ${formatLocalDate(chunkEnd)}`);

        // Hent opdaterede SKU-data for chunk
        const rawRows = client.fetchSkuDataUpdated(chunkStart, chunkEnd, new Set());

        // Dedup i memory på shop|orderId|sku
        const seen = new Set();
        const deduped = rawRows.filter(row => {
          const key = `${row[0]}|${row[1]}|${row[4]}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Filtrer ud alt vi allerede har i cachen
        const newRows = deduped.filter(row => {
          const key = `${row[0]}|${row[1]}|${row[4]}`;
          return !existingKeys.has(key);
        });

        // Upsert i stedet for ren tilføj – så refund felter opdateres på eksisterende rækker
        if (deduped.length > 0) {
          const written = upsertSkusOptimized(sheetName, deduped);
          totalWritten += written || 0;
          Logger.log(`✅ Upsertede ${written} rækker (${totalWritten} total)`);
        } else {
          Logger.log('ℹ️ Ingen rækker i denne chunk');
        }

        // Næste chunk
        chunkStart.setDate(chunkStart.getDate() + CHUNK_DAYS);
        Utilities.sleep(150);
      }

      Logger.log(`📦 ${shop.domain}: Backfill færdig, ${totalWritten} rækker skrevet`);
      Utilities.sleep(500);
    }

    Logger.log('🎉 Backfill af SKUs (updated_at) for måneden færdig');
  } catch (error) {
    Logger.log(`❌ Backfill fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

// Convenience wrapper for september 2025
function backfillSkuCacheUpdatedForSeptember2025() {
  return backfillSkuCacheUpdatedForMonth(2025, 9);
}

/**
 * 📅 BACKFILL: Hent alle ORDER-data for ordrer opdateret i en given måned
 * month: 1-12, year: 4-cifret. Henter i 7-dages chunks, dedup og batch-write.
 */
function backfillOrderCacheUpdatedForMonth(year, month) {
  Logger.log(`🧾 === BACKFILL ORDERS (updated_at) for ${year}-${('0' + month).slice(-2)} ===`);
  const sheetName = '_ORDER_CACHE';
  const CHUNK_DAYS = 7;

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);

  try {
    const sheet = getOrCreateSheet_(sheetName);

    for (const shop of SHOPS) {
      Logger.log(`\n🏪 ${shop.domain}: Backfill ${formatLocalDate(start)} → ${formatLocalDate(end)} (updated_at)`);

      const client = new ShopifyAPIClient(shop);
      const existingKeys = getExistingKeysOptimized(sheetName, 'orders'); // shop|orderId

      let chunkStart = new Date(start);
      let totalWritten = 0;

      while (chunkStart <= end) {
        let chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + (CHUNK_DAYS - 1));
        if (chunkEnd > end) chunkEnd = new Date(end);

        Logger.log(`🔎 Chunk ${formatLocalDate(chunkStart)} → ${formatLocalDate(chunkEnd)}`);

        // Hent både created og updated for at få alle relevante ændringer
        const createdOrders = client.fetchOrders(chunkStart, chunkEnd) || [];
        const updatedOrders = client.fetchOrdersUpdated(chunkStart, chunkEnd) || [];

        // Dedup på orderId
        const seen = new Set();
        const uniqueOrders = [...createdOrders, ...updatedOrders].filter(o => {
          if (seen.has(o.orderId)) return false;
          seen.add(o.orderId);
          return true;
        });

        // Map til rows-format (15 kolonner som i daglig incremental)
        const rows = uniqueOrders.map(o => [
          shop.domain,
          o.orderId,
          o.createdAt.slice(0, 10),
          o.country,
          o.discountedTotal,
          o.tax,
          o.shipping,
          o.itemCount,
          o.refundedAmount,
          o.refundedQty,
          o.refundDate,
          o.totalDiscountsExTax || 0,
          o.cancelledQty || 0,
          o.saleDiscountTotal || 0,
          o.combinedDiscountTotal || 0
        ]);

        // Upsert rows (opdater eksisterende + indsæt nye)
        if (rows.length > 0) {
          const written = upsertOrdersOptimized(sheetName, rows);
          totalWritten += written || 0;
          Logger.log(`✅ Upsertede ${written} rækker (${totalWritten} total)`);
        } else {
          Logger.log('ℹ️ Ingen rækker i denne chunk');
        }

        chunkStart.setDate(chunkStart.getDate() + CHUNK_DAYS);
        Utilities.sleep(150);
      }

      Logger.log(`📦 ${shop.domain}: Order backfill færdig, ${totalWritten} rækker skrevet`);
      Utilities.sleep(500);
    }

    Logger.log('🎉 Backfill af Orders (updated_at) for måneden færdig');
  } catch (error) {
    Logger.log(`❌ Order backfill fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

function backfillOrderCacheUpdatedForSeptember2025() {
  return backfillOrderCacheUpdatedForMonth(2025, 9);
}

/**
 * 🔥 TRUE FULL REBUILD: Hent ALT SKU data fra historisk start (2024-09-30)
 */
function trueFullSkuCacheRebuild() {
  Logger.log('🔥 === TRUE FULL SKU CACHE REBUILD ===');
  Logger.log('📅 Henter ALLE SKU data fra 2024-09-30 til nu...');
  const startTime = new Date();
  
  try {
    // 1. Clear sheet og timestamps
    const sheet = getOrCreateSheet_('_SKU_CACHE');
    sheet.clear();
    
    // Clear ALL sku timestamps
    SHOPS.forEach(shop => {
      PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_skus_${shop.domain}`);
    });
    
    // 2. Initialize headers
    sheet.appendRow([
      'shop', 'orderId', 'createdAt', 'country', 'sku', 
      'productTitle', 'variantTitle', 'quantity', 'refundedQty', 
      'priceDKK', 'refundDate'
    ]);
    
    Logger.log('📋 Headers tilføjet til SKU cache');
    
    let totalSkus = 0;
    
    // 3. Process hver shop fra historisk start
    for (const shop of SHOPS) {
      Logger.log(`\n🏪 === PROCESSING ${shop.domain} ===`);
      
      try {
        const client = new ShopifyAPIClient(shop);
        
        // Force full historical fetch
        const historicalStart = new Date('2024-09-30');
        const now = new Date();
        
        Logger.log(`📅 Periode: ${formatLocalDate(historicalStart)} → ${formatLocalDate(now)}`);
        Logger.log(`🗓️ Dage: ${Math.ceil((now - historicalStart) / (24 * 60 * 60 * 1000))}`);
        
        // Brug fetchSkuData funktion i stedet - den henter SKU data direkte
        const existingKeys = new Set(); // Tom set da vi genopbygger fra bunden
        const skuRows = client.fetchSkuData(historicalStart, now, existingKeys);
        
        Logger.log(`📦 Extracteret ${skuRows.length} SKU entries for ${shop.domain}`);
        
        // Batch write til sheet
        if (skuRows.length > 0) {
          const batchSize = 2000;
          let written = 0;
          
          for (let i = 0; i < skuRows.length; i += batchSize) {
            const batch = skuRows.slice(i, i + batchSize);
            const startRow = sheet.getLastRow() + 1;
            
            sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
            SpreadsheetApp.flush();
            
            written += batch.length;
            Logger.log(`   ✍️ ${written}/${skuRows.length} SKUs skrevet for ${shop.domain}`);
            
            // Small delay mellem batches
            if (i + batchSize < skuRows.length) {
              Utilities.sleep(500);
            }
          }
          
          totalSkus += skuRows.length;
          Logger.log(`✅ ${shop.domain}: ${skuRows.length} SKUs tilføjet til cache`);
        }
        
        // Set timestamp for denne shop
        PropertiesService.getScriptProperties().setProperty(
          `lastUpdate_skus_${shop.domain}`, 
          now.toISOString()
        );
        
        // Pause mellem shops
        Utilities.sleep(2000);
        
      } catch (shopError) {
        Logger.log(`❌ Fejl for ${shop.domain}: ${shopError.message}`);
      }
    }
    
    // 4. Final cleanup
    Logger.log('\n🧹 Fjerner duplikater...');
    const beforeDedupe = sheet.getLastRow() - 1;
    removeDuplicatesFromSheetSmart('_SKU_CACHE');
    const afterDedupe = sheet.getLastRow() - 1;
    const duplicatesRemoved = beforeDedupe - afterDedupe;
    
    const elapsed = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    
    Logger.log('\n🎉 === TRUE FULL SKU REBUILD COMPLETED ===');
    Logger.log(`⏱️ Total tid: ${elapsed} minutter`);
    Logger.log(`📦 Total SKUs tilføjet: ${totalSkus}`);
    Logger.log(`🧹 Duplikater fjernet: ${duplicatesRemoved}`);
    Logger.log(`📊 Final SKU cache størrelse: ${afterDedupe} rækker`);
    Logger.log(`📅 Periode: 2024-09-30 til ${formatLocalDate(new Date())}`);
    
    if (afterDedupe > 50000) {
      Logger.log('✅ SKU cache ser ud til at være komplet genopbygget! 🎉');
    } else {
      Logger.log('⚠️ SKU cache virker mindre end forventet - tjek for fejl');
    }
    
  } catch (error) {
    Logger.log(`❌ True full rebuild fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 🔥 TRUE FULL REBUILD: Hent ALLE order data fra historisk start (2024-09-30)
 */
function trueFullOrderCacheRebuild() {
  Logger.log('🔥 === TRUE FULL ORDER CACHE REBUILD ===');
  Logger.log('📅 Henter ALLE order data fra 2024-09-30 til nu...');
  const startTime = new Date();
  
  try {
    // 1. Clear sheet og timestamps
    const sheet = getOrCreateSheet_('_ORDER_CACHE');
    sheet.clear();
    
    // Clear ALL order timestamps
    SHOPS.forEach(shop => {
      PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_orders_${shop.domain}`);
    });
    
    // 2. Initialize headers
    sheet.appendRow([
      'shop', 'orderId', 'createdAt', 'country', 'discountedTotal',
      'tax', 'shipping', 'itemCount', 'refundedAmount', 'refundedQty', 'refundDate'
    ]);
    
    Logger.log('📋 Headers tilføjet til Order cache');
    
    let totalOrders = 0;
    
    // 3. Process hver shop fra historisk start
    for (const shop of SHOPS) {
      Logger.log(`\n🏪 === PROCESSING ${shop.domain} ===`);
      
      try {
        const client = new ShopifyAPIClient(shop);
        
        // Force full historical fetch
        const historicalStart = new Date('2024-09-30');
        const now = new Date();
        
        Logger.log(`📅 Periode: ${formatLocalDate(historicalStart)} → ${formatLocalDate(now)}`);
        Logger.log(`🗓️ Dage: ${Math.ceil((now - historicalStart) / (24 * 60 * 60 * 1000))}`);
        
        // Hent både created og updated orders
        const createdOrders = client.fetchOrders(historicalStart, now);
        Logger.log(`📦 Fundet ${createdOrders.length} created orders`);
        
        const updatedOrders = client.fetchOrdersUpdated(historicalStart, now);
        Logger.log(`🔄 Fundet ${updatedOrders.length} updated orders`);
        
        // Kombiner og dedup orders
        const allOrders = [...createdOrders, ...updatedOrders];
        const uniqueOrders = deduplicateByOrderId(allOrders);
        Logger.log(`✅ Efter deduplicering: ${uniqueOrders.length} unique orders`);
        
        // Konverter til rows format
        const orderRows = uniqueOrders.map(o => [
          shop.domain,
          o.orderId,
          o.createdAt.slice(0, 10),
          o.country,
          o.discountedTotal,
          o.tax,
          o.shipping,
          o.itemCount,
          o.refundedAmount,
          o.refundedQty,
          o.refundDate
        ]);
        
        Logger.log(`📦 Extracteret ${orderRows.length} order entries for ${shop.domain}`);
        
        // Batch write til sheet
        if (orderRows.length > 0) {
          const batchSize = 2000;
          let written = 0;
          
          for (let i = 0; i < orderRows.length; i += batchSize) {
            const batch = orderRows.slice(i, i + batchSize);
            const startRow = sheet.getLastRow() + 1;
            
            sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
            SpreadsheetApp.flush();
            
            written += batch.length;
            Logger.log(`   ✍️ ${written}/${orderRows.length} orders skrevet for ${shop.domain}`);
            
            // Small delay mellem batches
            if (i + batchSize < orderRows.length) {
              Utilities.sleep(500);
            }
          }
          
          totalOrders += orderRows.length;
          Logger.log(`✅ ${shop.domain}: ${orderRows.length} orders tilføjet til cache`);
        }
        
        // Set timestamp for denne shop
        PropertiesService.getScriptProperties().setProperty(
          `lastUpdate_orders_${shop.domain}`, 
          now.toISOString()
        );
        
        // Pause mellem shops
        Utilities.sleep(2000);
        
      } catch (shopError) {
        Logger.log(`❌ Fejl for ${shop.domain}: ${shopError.message}`);
      }
    }
    
    // 4. Final cleanup
    Logger.log('\n🧹 Fjerner duplikater...');
    const beforeDedupe = sheet.getLastRow() - 1;
    removeDuplicatesFromSheetSmart('_ORDER_CACHE');
    const afterDedupe = sheet.getLastRow() - 1;
    const duplicatesRemoved = beforeDedupe - afterDedupe;
    
    const elapsed = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    
    Logger.log('\n🎉 === TRUE FULL ORDER REBUILD COMPLETED ===');
    Logger.log(`⏱️ Total tid: ${elapsed} minutter`);
    Logger.log(`📦 Total orders tilføjet: ${totalOrders}`);
    Logger.log(`🧹 Duplikater fjernet: ${duplicatesRemoved}`);
    Logger.log(`📊 Final order cache størrelse: ${afterDedupe} rækker`);
    Logger.log(`📅 Periode: 2024-09-30 til ${formatLocalDate(new Date())}`);
    
    if (afterDedupe > 15000) {
      Logger.log('✅ Order cache ser ud til at være komplet genopbygget! 🎉');
    } else {
      Logger.log('⚠️ Order cache virker mindre end forventet - tjek for fejl');
    }
    
  } catch (error) {
    Logger.log(`❌ True full order rebuild fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 🔥 TRUE FULL REBUILD: Hent ALLE fulfillment data fra historisk start (2024-09-30)
 */
function trueFullFulfillmentCacheRebuild() {
  Logger.log('🔥 === TRUE FULL FULFILLMENT CACHE REBUILD ===');
  Logger.log('📅 Henter ALLE fulfillment data fra 2024-09-30 til nu...');
  const startTime = new Date();
  
  try {
    // 1. Clear sheet og timestamps
    const sheet = getOrCreateSheet_('_FULFILLMENT_CACHE');
    sheet.clear();
    
    // Clear ALL fulfillment timestamps
    SHOPS.forEach(shop => {
      PropertiesService.getScriptProperties().deleteProperty(`lastUpdate_fulfillments_${shop.domain}`);
    });
    
    // 2. Initialize headers
    sheet.appendRow([
      'orderId', 'date', 'country', 'carrier', 'itemCount'
    ]);
    
    Logger.log('📋 Headers tilføjet til Fulfillment cache');
    
    let totalFulfillments = 0;
    
    // 3. Process hver shop fra historisk start
    for (const shop of SHOPS) {
      Logger.log(`\n🏪 === PROCESSING ${shop.domain} ===`);
      
      try {
        const client = new ShopifyAPIClient(shop);
        
        // Force full historical fetch
        const historicalStart = new Date('2024-09-30');
        const now = new Date();
        
        Logger.log(`📅 Periode: ${formatLocalDate(historicalStart)} → ${formatLocalDate(now)}`);
        Logger.log(`🗓️ Dage: ${Math.ceil((now - historicalStart) / (24 * 60 * 60 * 1000))}`);
        
        // Hent fulfillments
        const fulfillments = client.fetchFulfillments(historicalStart, now);
        Logger.log(`📦 Fundet ${fulfillments.length} fulfillments for ${shop.domain}`);
        
        // Konverter til rows format
        const fulfillmentRows = fulfillments.map(f => [
          f.orderId,
          f.date.slice(0, 10),
          f.country,
          f.carrier,
          f.itemCount
        ]);
        
        Logger.log(`📦 Extracteret ${fulfillmentRows.length} fulfillment entries for ${shop.domain}`);
        
        // Batch write til sheet
        if (fulfillmentRows.length > 0) {
          const batchSize = 2000;
          let written = 0;
          
          for (let i = 0; i < fulfillmentRows.length; i += batchSize) {
            const batch = fulfillmentRows.slice(i, i + batchSize);
            const startRow = sheet.getLastRow() + 1;
            
            sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
            SpreadsheetApp.flush();
            
            written += batch.length;
            Logger.log(`   ✍️ ${written}/${fulfillmentRows.length} fulfillments skrevet for ${shop.domain}`);
            
            // Small delay mellem batches
            if (i + batchSize < fulfillmentRows.length) {
              Utilities.sleep(500);
            }
          }
          
          totalFulfillments += fulfillmentRows.length;
          Logger.log(`✅ ${shop.domain}: ${fulfillmentRows.length} fulfillments tilføjet til cache`);
        }
        
        // Set timestamp for denne shop
        PropertiesService.getScriptProperties().setProperty(
          `lastUpdate_fulfillments_${shop.domain}`, 
          now.toISOString()
        );
        
        // Pause mellem shops
        Utilities.sleep(2000);
        
      } catch (shopError) {
        Logger.log(`❌ Fejl for ${shop.domain}: ${shopError.message}`);
      }
    }
    
    // 4. Final cleanup
    Logger.log('\n🧹 Fjerner duplikater...');
    const beforeDedupe = sheet.getLastRow() - 1;
    removeDuplicatesFromSheetSmart('_FULFILLMENT_CACHE');
    const afterDedupe = sheet.getLastRow() - 1;
    const duplicatesRemoved = beforeDedupe - afterDedupe;
    
    const elapsed = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    
    Logger.log('\n🎉 === TRUE FULL FULFILLMENT REBUILD COMPLETED ===');
    Logger.log(`⏱️ Total tid: ${elapsed} minutter`);
    Logger.log(`📦 Total fulfillments tilføjet: ${totalFulfillments}`);
    Logger.log(`🧹 Duplikater fjernet: ${duplicatesRemoved}`);
    Logger.log(`📊 Final fulfillment cache størrelse: ${afterDedupe} rækker`);
    Logger.log(`📅 Periode: 2024-09-30 til ${formatLocalDate(new Date())}`);
    
    if (afterDedupe > 10000) {
      Logger.log('✅ Fulfillment cache ser ud til at være komplet genopbygget! 🎉');
    } else {
      Logger.log('⚠️ Fulfillment cache virker mindre end forventet - tjek for fejl');
    }
    
  } catch (error) {
    Logger.log(`❌ True full fulfillment rebuild fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 🔥 TRUE FULL REBUILD: Genopbyg inventory cache fra scratch
 */
function trueFullInventoryCacheRebuild() {
  Logger.log('🔥 === TRUE FULL INVENTORY CACHE REBUILD ===');
  Logger.log('📦 Henter ALT inventory data fra dansk shop...');
  const startTime = new Date();
  
  try {
    // 1. Clear sheet og timestamps
    const sheet = getOrCreateSheet_('_INVENTORY_CACHE');
    sheet.clear();
    
    PropertiesService.getScriptProperties().deleteProperty('inventory_last_update');
    
    // 2. Initialize headers
    sheet.appendRow([
      'sku', 'inventory', 'lastUpdate'
    ]);
    
    Logger.log('📋 Headers tilføjet til Inventory cache');
    
    // 3. Hent fra dansk shop (kun den har authoritative inventory)
    const danskShop = SHOPS[0]; // pompdelux-da.myshopify.com
    Logger.log(`🏪 Henter inventory fra ${danskShop.domain}...`);
    
    const client = new GraphQLClient(danskShop);
    let cursor = null;
    let totalVariants = 0;
    const inventoryData = {};
    
    const query = (cursorVal) => `
      query {
        productVariants(first: 250${cursorVal ? `, after: "${cursorVal}"` : ""}) {
          edges {
            cursor
            node {
              sku
              inventoryQuantity
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    
    // 4. Fetch all inventory data
    while (true) {
      const data = client.query(query(cursor));
      const edges = data.productVariants.edges || [];
      
      edges.forEach(edge => {
        const variant = edge.node;
        const sku = (variant.sku || "").trim().toUpperCase();
        if (!sku || sku === 'NO_SKU') return;
        
        const inventory = Math.max(0, variant.inventoryQuantity || 0);
        inventoryData[sku] = inventory;
        totalVariants++;
      });
      
      Logger.log(`   📦 Processed ${totalVariants} inventory records so far...`);
      
      if (!data.productVariants.pageInfo.hasNextPage) break;
      cursor = edges[edges.length - 1].cursor;
      
      // Rate limit
      Utilities.sleep(250);
    }
    
    Logger.log(`📦 Total inventory records: ${totalVariants}`);
    
    // 5. Batch write til sheet
    if (Object.keys(inventoryData).length > 0) {
      const rows = Object.entries(inventoryData).map(([sku, inventory]) => [
        sku,
        inventory,
        new Date()
      ]);
      
      const batchSize = 2000;
      let written = 0;
      
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const startRow = sheet.getLastRow() + 1;
        
        sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
        SpreadsheetApp.flush();
        
        written += batch.length;
        Logger.log(`   ✍️ ${written}/${rows.length} inventory records skrevet`);
        
        // Small delay mellem batches
        if (i + batchSize < rows.length) {
          Utilities.sleep(500);
        }
      }
      
      Logger.log(`✅ ${rows.length} inventory records tilføjet til cache`);
    }
    
    // 6. Set timestamp
    PropertiesService.getScriptProperties().setProperty(
      'inventory_last_update', 
      new Date().toISOString()
    );
    
    // 7. Final cleanup (minimal for inventory)
    Logger.log('\n🧹 Fjerner eventuelle duplikater...');
    const beforeDedupe = sheet.getLastRow() - 1;
    removeDuplicatesFromSheetSmart('_INVENTORY_CACHE');
    const afterDedupe = sheet.getLastRow() - 1;
    const duplicatesRemoved = beforeDedupe - afterDedupe;
    
    const elapsed = ((new Date() - startTime) / 1000 / 60).toFixed(2);
    
    Logger.log('\n🎉 === TRUE FULL INVENTORY REBUILD COMPLETED ===');
    Logger.log(`⏱️ Total tid: ${elapsed} minutter`);
    Logger.log(`📦 Total inventory records: ${totalVariants}`);
    Logger.log(`🧹 Duplikater fjernet: ${duplicatesRemoved}`);
    Logger.log(`📊 Final inventory cache størrelse: ${afterDedupe} rækker`);
    
    if (afterDedupe > 5000) {
      Logger.log('✅ Inventory cache ser ud til at være komplet genopbygget! 🎉');
    } else {
      Logger.log('⚠️ Inventory cache virker mindre end forventet - tjek for fejl');
    }
    
  } catch (error) {
    Logger.log(`❌ True full inventory rebuild fejl: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Helper function: Deduplicate orders by orderId
 */
function deduplicateByOrderId(orders) {
  const seen = new Set();
  return orders.filter(order => {
    if (seen.has(order.orderId)) {
      return false;
    }
    seen.add(order.orderId);
    return true;
  });
}

/**
 * 🎛️ OVERSIGT: Alle tilgængelige True Full Rebuild funktioner
 */
function listAllTrueFullRebuildFunctions() {
  Logger.log('🎛️ === ALLE TRUE FULL REBUILD FUNKTIONER ===');
  Logger.log('');
  Logger.log('📦 INDIVIDUAL CACHE REBUILDS:');
  Logger.log('  • trueFullSkuCacheRebuild()         - Genopbyg SKU cache fra 2024-09-30');
  Logger.log('  • trueFullOrderCacheRebuild()       - Genopbyg Order cache fra 2024-09-30');
  Logger.log('  • trueFullFulfillmentCacheRebuild() - Genopbyg Fulfillment cache fra 2024-09-30');
  Logger.log('  • trueFullInventoryCacheRebuild()   - Genopbyg Inventory cache (current data)');
  Logger.log('  • rebuildMetadataCache()            - Genopbyg Metadata cache (current data)');
  Logger.log('');
  Logger.log('🚨 MASTER REBUILD:');
  Logger.log('  • rebuildAllCachesFromScratch()     - Genopbyg ALLE caches');
  Logger.log('');
  Logger.log('📊 EXPECTED SIZES:');
  Logger.log('  • SKU Cache:        50,000+ rækker');
  Logger.log('  • Order Cache:      15,000+ rækker');
  Logger.log('  • Fulfillment Cache:10,000+ rækker');
  Logger.log('  • Inventory Cache:   5,000+ rækker');
  Logger.log('  • Metadata Cache:    8,000+ rækker');
  Logger.log('');
  Logger.log('⚠️ ADVARSEL: Disse funktioner sletter eksisterende data!');
  Logger.log('⏱️ TID: Hver rebuild tager 10-30 minutter afhængigt af cache størrelse');
}