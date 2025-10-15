// === ShopifyAPIClient.gs ===
// 📡 Unified client til at hente alle data fra Shopify pr. shop

class ShopifyAPIClient {
  constructor(shop) {
    this.shop = {
      ...shop,
      token: getToken(shop.domain)
    };
    this.graphql = new GraphQLClient(this.shop);
    
    // Brug dynamiske kurser
    const rates = getCurrentExchangeRates();
    this.rate = rates[shop.domain] || 1;
    
    Logger.log(`🏪 ${shop.domain} bruger kurs: ${this.rate.toFixed(2)}`);
  }

  fetchOrders(startDate, endDate) {
  const isoStart = startDate.toISOString();
  const isoEnd = endDate.toISOString();
  const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
  const output = [];
  let cursor = null;

  const buildQuery = (cursorVal) => `
    query {
      orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
        edges {
          cursor
          node {
            id
            createdAt
            shippingAddress { countryCode }
            currentTotalPriceSet { shopMoney { amount } }
            subtotalPriceSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            originalTotalPriceSet { shopMoney { amount } }
            
            # Ordre-niveau moms information til rabat-opdeling
            taxesIncluded
            taxLines {
              rate
              title
              priceSet { shopMoney { amount } }
            }
            
            shippingLines(first: 1) {
              edges {
                node {
                  price
                  taxLines {
                    rate
                    price
                  }
                }
              }
            }
            lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
              edges { 
                node { 
                  id
                  quantity
                  
                  # Pris information for historisk korrekthed
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedUnitPriceSet { shopMoney { amount } }
                  
                  # Rabatkode-rabat information
                  discountAllocations {
                    allocatedAmountSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    discountApplication {
                      ... on DiscountCodeApplication {
                        code
                      }
                      ... on AutomaticDiscountApplication {
                        title
                      }
                    }
                  }
                  
                  # Variant information for Compare At Price
                  variant {
                    id
                    price
                    compareAtPrice
                  }
                }
              }
            }
            refunds {
              createdAt
              totalRefundedSet { shopMoney { amount } }
              orderAdjustments(first: 50) {
                edges {
                  node {
                    amountSet { shopMoney { amount } }
                    taxAmountSet { shopMoney { amount } }
                  }
                }
              }
              refundLineItems(first: 100) {
                edges {
                  node {
                    quantity
                    subtotalSet { shopMoney { amount } }
                    lineItem {
                      id
                      sku
                      title
                      variantTitle
                      originalUnitPriceSet { shopMoney { amount } }
                    }
                  }
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
      const data = this.graphql.query(buildQuery(cursor));
      const edges = data.orders.edges || [];

      for (const edge of edges) {
        const o = edge.node;

        // 💸 Udregn fragt ekskl. moms
        const shippingLines = o.shippingLines?.edges || [];
        let shippingExVat = 0;

        shippingLines.forEach(line => {
          const gross = parseFloat(line.node.price || 0);
          const tax = (line.node.taxLines || []).reduce(
            (sum, tl) => sum + parseFloat(tl.price || 0),
            0
          );
          shippingExVat += gross - tax;
        });

        // 💰 Definer værdier først for at undgå initialization fejl
        const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0);
        const currentTotal = parseFloat(o.currentTotalPriceSet?.shopMoney?.amount || 0);
        const originalTotal = parseFloat(o.originalTotalPriceSet?.shopMoney?.amount || 0);
        const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
        const totalDiscountsInclTax = parseFloat(o.totalDiscountsSet?.shopMoney?.amount || 0);

        // 🔁 Analyser refunds for at skelne mellem cancellations og refunds
        let totalRefundedAmount = 0;
        let totalRefundedQty = 0;
        let totalCancelledAmount = 0;
        let totalCancelledQty = 0;
        let totalCancelledTax = 0;
        let lastRefundDate = "";
        const cancelledLineItemIds = new Set(); // Track cancelled line items

        o.refunds.forEach(r => {
          const refundTotal = parseFloat(r.totalRefundedSet?.shopMoney?.amount || 0);
          
          if (refundTotal > 0) {
            // Faktisk refund - kunden har fået penge retur
            totalRefundedAmount += refundTotal;
            const refundQty = r.refundLineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0);
            totalRefundedQty += refundQty;
            if (r.createdAt > lastRefundDate) {
              lastRefundDate = r.createdAt;
            }
          } else {
            // Cancellation - items fjernet før betaling (totalRefunded = 0)
            const cancelledItems = r.refundLineItems.edges || [];
            cancelledItems.forEach(edge => {
              const item = edge.node;
              const cancelledQty = item.quantity || 0;
              const cancelledItemValue = parseFloat(item.subtotalSet?.shopMoney?.amount || 0);
              
              // Track cancelled line item ID
              if (item.lineItem && item.lineItem.id) {
                cancelledLineItemIds.add(item.lineItem.id);
              }
              
              totalCancelledQty += cancelledQty;
              totalCancelledAmount += cancelledItemValue;
              
              // Beregn moms på annullerede items baseret på ordrens faktiske momssats
              if (cancelledItemValue > 0 && subtotal > 0 && totalTax > 0) {
                // Beregn faktisk momssats fra ordren (totalTax/subtotal forholdning)
                const effectiveTaxRate = totalTax / subtotal;
                const cancelledItemTax = cancelledItemValue * effectiveTaxRate;
                totalCancelledTax += cancelledItemTax;
              }
            });
          }
        });

        // For backward compatibility - brug som tidligere hvis ingen nye felter
        const refunded = o.refunds.map(r => ({
          createdAt: r.createdAt,
          quantity: r.refundLineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0),
          totalAmount: parseFloat(r.totalRefundedSet?.shopMoney?.amount || 0)
        }));
        const lastRefund = refunded.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

        // 💰 Værdier allerede defineret øverst
        
        // Debug logging for ordre fra 2025-06-06
        if (o.createdAt && o.createdAt.startsWith('2025-06-06')) {
          Logger.log(`🔍 DEBUG Order ${o.id} (${o.createdAt}):`);
          Logger.log(`  subtotalPriceSet: ${subtotal}`);
          Logger.log(`  currentTotalPriceSet: ${currentTotal}`);
          Logger.log(`  originalTotalPriceSet: ${originalTotal}`);
          Logger.log(`  totalTaxSet: ${totalTax}`);
          Logger.log(`  totalDiscountsSet: ${totalDiscountsInclTax}`);
          Logger.log(`  shipping calculated: ${shippingExVat}`);
          Logger.log(`  refunded amount: ${refunded.reduce((sum, r) => sum + r.totalAmount, 0)}`);
        }
        
        // Beregn rabat ekskl. moms - CORRECTED
        let totalDiscountsExTax = totalDiscountsInclTax;
        if (subtotal > 0 && totalTax > 0) {
          // Problem: totalTax inkluderer moms på fragt, men rabat gælder kun produkter
          // Løsning: Brug kun produktmoms til at beregne momssats for rabat
          const shippingTax = shippingExVat * 0.25; // 25% moms på fragt
          const productTax = totalTax - shippingTax; // Moms kun på produkter
          const productSubtotalInclTax = subtotal; // subtotal er allerede inkl. moms
          const productSubtotalExTax = productSubtotalInclTax - productTax;
          
          if (productSubtotalExTax > 0) {
            const taxRateOnProducts = productTax / productSubtotalExTax;
            totalDiscountsExTax = totalDiscountsInclTax / (1 + taxRateOnProducts);
          }
        }

        // 🔢 BEREGN RABAT-OPDELING (rabatkode vs nedsat pris) - ekskluder cancelled items
        let discountCodeTotal = 0;
        let saleDiscountTotal = 0;

        o.lineItems.edges.forEach(li => {
          const lineItem = li.node;
          const quantity = lineItem.quantity || 0;
          
          if (quantity === 0) return;
          
          // Skip cancelled line items - de skal ikke tælle med i rabat-beregningerne
          if (cancelledLineItemIds.has(lineItem.id)) {
            return;
          }

          // 1. RABATKODE-RABAT (fra discountAllocations)
          const lineDiscountCodeAmount = lineItem.discountAllocations.reduce((sum, allocation) => {
            return sum + parseFloat(allocation.allocatedAmountSet.shopMoney.amount);
          }, 0);
          discountCodeTotal += lineDiscountCodeAmount;

          // 2. NEDSAT PRIS-RABAT (fra compareAtPrice vs faktisk betalt pris)
          const discountedPrice = parseFloat(lineItem.discountedUnitPriceSet?.shopMoney?.amount || 0);
          const compareAtPrice = parseFloat(lineItem.variant?.compareAtPrice || 0);
          
          // Kun beregn sale discount hvis compareAtPrice er højere end den faktisk betalte pris
          const lineSaleDiscount = (compareAtPrice > discountedPrice) ? (compareAtPrice - discountedPrice) * quantity : 0;
          saleDiscountTotal += lineSaleDiscount;
        });

        // Beregn ex-moms værdier for rabat-opdeling
        let taxRate = 0.25; // Default fallback
        
        // Hent faktisk momssats fra ordre
        if (o.taxLines && o.taxLines.length > 0) {
          taxRate = parseFloat(o.taxLines[0].rate) || 0.25;
        }
        
        // Beregn ex-moms værdier for rabat-opdeling
        const discountCodeTotalExVat = discountCodeTotal / (1 + taxRate);
        const saleDiscountTotalExVat = saleDiscountTotal / (1 + taxRate);
        const combinedDiscountTotalExVat = discountCodeTotalExVat + saleDiscountTotalExVat;

        // Konverter til DKK
        const discountCodeTotalDKK = discountCodeTotalExVat * this.rate;
        const saleDiscountTotalDKK = saleDiscountTotalExVat * this.rate;
        const combinedDiscountTotalDKK = combinedDiscountTotalExVat * this.rate;

        // Justeret discountedTotal og tax - fratrækker annullerede items
        const adjustedDiscountedTotal = (subtotal - totalCancelledAmount) * this.rate;
        const adjustedTax = (totalTax - totalCancelledTax) * this.rate;

        output.push({
          orderId: o.id,
          createdAt: o.createdAt,
          country: o.shippingAddress?.countryCode || "Unknown",
          discountedTotal: adjustedDiscountedTotal, // Fratrukket annullerede items
          tax: adjustedTax, // Fratrukket moms på annullerede items
          shipping: shippingExVat * this.rate,
          itemCount: o.lineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0),
          refundedAmount: totalRefundedAmount * this.rate, // Kun faktiske refunds
          refundedQty: totalRefundedQty, // Kun faktiske refunds
          refundDate: lastRefundDate || (lastRefund ? lastRefund.createdAt : ""),
          totalDiscountsExTax: discountCodeTotalDKK, // L: rabatkode-rabat (ex moms) ⭐ 
          cancelledQty: totalCancelledQty, // M: annullerede items
          // NYE KOLONNER FOR RABAT-OPDELING (EX MOMS)
          saleDiscountTotal: saleDiscountTotalDKK,        // N: nedsat pris rabat (ex moms) ⭐
          combinedDiscountTotal: combinedDiscountTotalDKK // O: samlet rabat (ex moms) ⭐
        });
      }

      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = edges[edges.length - 1].cursor;
      sleep(CONFIG.RATE_LIMIT_MS);
    }

  } catch (err) {
    Logger.log(`💥 Fejl i fetchOrders: ${err.message}`);
  }

  return output;
}

  fetchFulfillments(startDate, endDate) {
    const output = [];
    let cursor = null;

    // FIXED: Søg bredere for ordrer og filtrer fulfillments på deres createdAt
    // Udvid søgevinduet til at inkludere ordrer fra 90 dage før startDate
    const orderSearchStart = new Date(startDate);
    orderSearchStart.setDate(orderSearchStart.getDate() - 90);
    
    const isoOrderStart = orderSearchStart.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `fulfillment_status:fulfilled created_at:>=${isoOrderStart} created_at:<=${isoEnd}`;

    Logger.log(`🔍 fetchFulfillments: Søger ordrer fra ${formatLocalDate(orderSearchStart)} til ${formatLocalDate(endDate)}, filtrerer fulfillments ${formatLocalDate(startDate)}-${formatLocalDate(endDate)}`);

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              shippingAddress { countryCode }
              fulfillments {
                createdAt
                trackingInfo { company }
                fulfillmentLineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                  edges { node { quantity } }
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
        const data = this.graphql.query(buildQuery(cursor));
        const edges = data?.orders?.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const country = order.shippingAddress?.countryCode || "Unknown";

          order.fulfillments.forEach(f => {
            const created = new Date(f.createdAt);
            // FIXED: Kun inkluder fulfillments der faktisk blev shipped i target datointervallet
            if (created >= startDate && created <= endDate) {
              const carrier = f.trackingInfo?.[0]?.company || "Ukendt";
              const itemCount = f.fulfillmentLineItems.edges.reduce(
                (sum, li) => sum + (li.node.quantity || 0), 0
              );

              output.push({
                orderId: order.id,
                date: created.toISOString(),
                country,
                carrier,
                itemCount
              });
            }
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;
        sleep(CONFIG.RATE_LIMIT_MS);
      }
    } catch (err) {
      Logger.log(`💥 [${this.shop.domain}] Fejl i fetchFulfillments: ${err.message}`);
    }

    Logger.log(`✅ [${this.shop.domain}] fetchFulfillments: ${output.length} fulfillments fundet`);
    return output;
  }

  fetchSkuData(startDate, endDate, existingKeys = new Set()) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `created_at:>=${isoStart} created_at:<=${isoEnd}`;
    const rows = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              taxesIncluded
              totalTaxSet { shopMoney { amount } }
              currentSubtotalPriceSet { shopMoney { amount } }
              shippingAddress { countryCode }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges {
                  node {
                    sku
                    title
                    variantTitle
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    discountedUnitPriceSet { shopMoney { amount } }
                  }
                }
              }
              refunds {
                createdAt
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                      lineItem { sku }
                    }
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
        const data = this.graphql.query(buildQuery(cursor));
        const orders = data.orders.edges || [];

        for (const edge of orders) {
          const o = edge.node;
          const orderId = o.id;
          const createdAt = o.createdAt;
          const country = o.shippingAddress?.countryCode || "Unknown";
          const taxesIncluded = o.taxesIncluded || false;

          // 💰 Beregn den samlede momssats for ordren
          let orderTaxRate = 0;
          if (taxesIncluded) {
            const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
            const subtotal = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || 0);
            
            if (subtotal > 0) {
              // Momssats = total moms / (subtotal - total moms)
              // Fordi subtotal i Shopify inkluderer moms når taxesIncluded=true
              orderTaxRate = totalTax / (subtotal - totalTax);
            }
          }

          const refundMap = {};
          let latestRefund = "";

          o.refunds.forEach(refund => {
            if (refund.createdAt > latestRefund) latestRefund = refund.createdAt;
            refund.refundLineItems.edges.forEach(e => {
              const sku = (e.node.lineItem?.sku || "").trim().toUpperCase();
              if (sku) {
                refundMap[sku] = (refundMap[sku] || 0) + (e.node.quantity || 0);
              }
            });
          });

          o.lineItems.edges.forEach(li => {
            const node = li.node;
            const sku = (node.sku || "NO_SKU").trim().toUpperCase();
            const key = `${this.shop.domain}|${orderId}|${sku}`;

            if (!existingKeys.has(key)) {
              const qty = node.quantity || 0;
              const refundedQty = refundMap[sku] || 0;
              
              // Hent pris inklusive moms
              const unitPriceIncVat = parseFloat(
                node.discountedUnitPriceSet?.shopMoney?.amount || 
                node.originalUnitPriceSet?.shopMoney?.amount || 0
              );

              // Beregn pris eksklusive moms baseret på ordrens momssats
              let unitPriceExVat = unitPriceIncVat;
              
              if (taxesIncluded && orderTaxRate > 0) {
                // Konverter fra inklusive til eksklusive moms
                unitPriceExVat = unitPriceIncVat / (1 + orderTaxRate);
              }

              const totalPriceExVat = unitPriceExVat * qty;
              const price = totalPriceExVat * this.rate;

              rows.push([
                this.shop.domain,
                orderId,
                createdAt.slice(0, 10),
                country,
                sku,
                node.title || "",
                node.variantTitle || "",
                qty,
                refundedQty,
                price,
                latestRefund || ""
              ]);

              existingKeys.add(key);
            }
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = orders[orders.length - 1].cursor;
        sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      Logger.log(`💥 [${this.shop.domain}] Fejl i fetchSkuData: ${err.message}`);
    }

    return rows;
  }

  /**
   * Hent ordrer der er opdateret i perioden (for retur-info)
   */
  fetchOrdersUpdated(startDate, endDate) {
    const output = [];
    let cursor = null;

    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `updated_at:>=${isoStart} updated_at:<=${isoEnd}`;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              updatedAt
              shippingAddress { countryCode }
              subtotalPriceSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              totalShippingPriceSet { shopMoney { amount } }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges { 
                  node { 
                    id
                    quantity
                    
                    # Pris information for rabat-beregning
                    originalUnitPriceSet { shopMoney { amount } }
                    discountedUnitPriceSet { shopMoney { amount } }
                    
                    # Rabatkode-rabat information
                    discountAllocations {
                      allocatedAmountSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      discountApplication {
                        ... on DiscountCodeApplication {
                          code
                        }
                        ... on AutomaticDiscountApplication {
                          title
                        }
                      }
                    }
                    
                    # Variant information for Compare At Price
                    variant {
                      id
                      price
                      compareAtPrice
                    }
                  }
                }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                orderAdjustments(first: 50) {
                  edges {
                    node {
                      amountSet { shopMoney { amount } }
                      taxAmountSet { shopMoney { amount } }
                    }
                  }
                }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                      subtotalSet { shopMoney { amount } }
                      lineItem {
                        sku
                        title
                        variantTitle
                        originalUnitPriceSet { shopMoney { amount } }
                      }
                    }
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
        const data = this.graphql.query(buildQuery(cursor));
        const edges = data?.orders?.edges || [];

        for (const edge of edges) {
          const o = edge.node;
          const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0);
          const discount = parseFloat(o.totalDiscountsSet?.shopMoney?.amount || 0);
          const tax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
          const shipping = parseFloat(o.totalShippingPriceSet?.shopMoney?.amount || 0);

          // 🔁 Analyser refunds for at skelne mellem cancellations og refunds (samme logik som fetchOrders)
          let totalRefundedAmount = 0;
          let totalRefundedQty = 0;
          let totalCancelledAmount = 0;
          let totalCancelledQty = 0;
          let totalCancelledTax = 0;
          let lastRefundDate = "";

          o.refunds.forEach(r => {
            const refundTotal = parseFloat(r.totalRefundedSet?.shopMoney?.amount || 0);
            
            if (refundTotal > 0) {
              // Faktisk refund - kunden har fået penge retur
              totalRefundedAmount += refundTotal;
              const refundQty = r.refundLineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0);
              totalRefundedQty += refundQty;
              if (r.createdAt > lastRefundDate) {
                lastRefundDate = r.createdAt;
              }
            } else {
              // Cancellation - items fjernet før betaling (totalRefunded = 0)
              const cancelledItems = r.refundLineItems.edges || [];
              cancelledItems.forEach(edge => {
                const item = edge.node;
                const cancelledQty = item.quantity || 0;
                const cancelledItemValue = parseFloat(item.subtotalSet?.shopMoney?.amount || 0);
                
                totalCancelledQty += cancelledQty;
                totalCancelledAmount += cancelledItemValue;
                
                // Beregn moms på annullerede items baseret på ordrens faktiske momssats
                if (cancelledItemValue > 0 && subtotal > 0 && tax > 0) {
                  // Beregn faktisk momssats fra ordren
                  const effectiveTaxRate = tax / subtotal;
                  const cancelledItemTax = cancelledItemValue * effectiveTaxRate;
                  totalCancelledTax += cancelledItemTax;
                }
              });
            }
          });

          // Justeret discountedTotal og tax - fratrækker annullerede items
          const adjustedDiscountedTotal = (subtotal - totalCancelledAmount) * this.rate;
          const adjustedTax = (tax - totalCancelledTax) * this.rate;

          // 🔢 BEREGN RABAT-OPDELING (samme logik som fetchOrders)
          let discountCodeTotal = 0;
          let saleDiscountTotal = 0;

          o.lineItems.edges.forEach(li => {
            const lineItem = li.node;
            const quantity = lineItem.quantity || 0;
            
            // Skip hvis ingen quantity
            if (quantity <= 0) {
              return;
            }
            
            // 1. RABATKODE-RABAT (fra discountAllocations)
            const lineDiscountCodeAmount = lineItem.discountAllocations.reduce((sum, allocation) => {
              return sum + parseFloat(allocation.allocatedAmountSet.shopMoney.amount);
            }, 0);
            discountCodeTotal += lineDiscountCodeAmount;

            // 2. NEDSAT PRIS-RABAT (fra compareAtPrice vs faktisk betalt pris)
            const discountedPrice = parseFloat(lineItem.discountedUnitPriceSet?.shopMoney?.amount || 0);
            const compareAtPrice = parseFloat(lineItem.variant?.compareAtPrice || 0);
            
            // Kun beregn sale discount hvis compareAtPrice er højere end den faktisk betalte pris
            const lineSaleDiscount = (compareAtPrice > discountedPrice) ? (compareAtPrice - discountedPrice) * quantity : 0;
            saleDiscountTotal += lineSaleDiscount;
          });

          // Beregn ex-moms værdier for rabat-opdeling
          let taxRate = 0.25; // Default fallback
          
          if (subtotal > 0 && tax > 0) {
            taxRate = tax / subtotal;
          }
          
          // Beregn ex-moms værdier for rabat-opdeling
          const discountCodeTotalExVat = discountCodeTotal / (1 + taxRate);
          const saleDiscountTotalExVat = saleDiscountTotal / (1 + taxRate);
          const combinedDiscountTotalExVat = discountCodeTotalExVat + saleDiscountTotalExVat;

          // Konverter til DKK
          const discountCodeTotalDKK = discountCodeTotalExVat * this.rate;
          const saleDiscountTotalDKK = saleDiscountTotalExVat * this.rate;
          const combinedDiscountTotalDKK = combinedDiscountTotalExVat * this.rate;

          output.push({
            orderId: o.id,
            createdAt: o.createdAt,
            country: o.shippingAddress?.countryCode || "Unknown",
            discountedTotal: adjustedDiscountedTotal, // Fratrukket annullerede items
            tax: adjustedTax, // Fratrukket moms på annullerede items
            shipping: shipping * this.rate,
            itemCount: o.lineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0),
            refundedAmount: totalRefundedAmount * this.rate, // Kun faktiske refunds
            refundedQty: totalRefundedQty, // Kun faktiske refunds
            refundDate: lastRefundDate,
            totalDiscountsExTax: discountCodeTotalDKK, // L: rabatkode-rabat (ex moms) ⭐
            cancelledQty: totalCancelledQty, // M: annullerede items
            // NYE KOLONNER FOR RABAT-OPDELING (EX MOMS)
            saleDiscountTotal: saleDiscountTotalDKK,        // N: nedsat pris rabat (ex moms) ⭐
            combinedDiscountTotal: combinedDiscountTotalDKK // O: samlet rabat (ex moms) ⭐
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;
        sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      Logger.log(`💥 Fejl i fetchOrdersUpdated: ${err.message}`);
    }

    return output;
  }

  /**
   * Hent fulfillments der er opdateret i perioden (for ændrede leveringer)
   */
  fetchFulfillmentsUpdated(startDate, endDate) {
    const output = [];
    let cursor = null;

    // Søg for ordrer opdateret i perioden (bredere søgning som i original metode)
    const orderSearchStart = new Date(startDate);
    orderSearchStart.setDate(orderSearchStart.getDate() - 90);
    
    const isoOrderStart = orderSearchStart.toISOString();
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    
    // Søg efter ordrer opdateret i perioden med fulfillment_status
    const queryFilter = `fulfillment_status:fulfilled updated_at:>=${isoStart} updated_at:<=${isoEnd}`;

    Logger.log(`🔍 fetchFulfillmentsUpdated: Søger ordrer opdateret ${formatLocalDate(startDate)}-${formatLocalDate(endDate)}`);

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              updatedAt
              shippingAddress { countryCode }
              fulfillments {
                createdAt
                updatedAt
                trackingInfo { company }
                fulfillmentLineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                  edges { node { quantity } }
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
        const data = this.graphql.query(buildQuery(cursor));
        const edges = data?.orders?.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const country = order.shippingAddress?.countryCode || "Unknown";

          order.fulfillments.forEach(f => {
            const fulfillmentCreated = new Date(f.createdAt);
            const fulfillmentUpdated = new Date(f.updatedAt || f.createdAt);
            
            // Inkluder fulfillments der blev opdateret i target-perioden
            // ELLER blev oprettet i perioden (fallback)
            const isRelevant = (fulfillmentUpdated >= startDate && fulfillmentUpdated <= endDate) ||
                              (fulfillmentCreated >= startDate && fulfillmentCreated <= endDate);
            
            if (isRelevant) {
              const carrier = f.trackingInfo?.[0]?.company || "Ukendt";
              const itemCount = f.fulfillmentLineItems.edges.reduce(
                (sum, li) => sum + (li.node.quantity || 0), 0
              );

              output.push({
                orderId: order.id,
                date: fulfillmentCreated.toISOString(),
                country,
                carrier,
                itemCount
              });
            }
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;
        sleep(CONFIG.RATE_LIMIT_MS);
      }
    } catch (err) {
      Logger.log(`💥 [${this.shop.domain}] Fejl i fetchFulfillmentsUpdated: ${err.message}`);
    }

    Logger.log(`✅ [${this.shop.domain}] fetchFulfillmentsUpdated: ${output.length} fulfillments fundet`);
    return output;
  }

  /**
   * Hent SKU data der er opdateret i perioden
   */
  fetchSkuDataUpdated(startDate, endDate, existingKeys = new Set()) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `updated_at:>=${isoStart} updated_at:<=${isoEnd}`;
    const rows = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        orders(first: ${CONFIG.MAX_ORDERS_PER_PAGE}${cursorVal ? `, after: "${cursorVal}"` : ""}, query: "${queryFilter}") {
          edges {
            cursor
            node {
              id
              createdAt
              taxesIncluded
              totalTaxSet { shopMoney { amount } }
              currentSubtotalPriceSet { shopMoney { amount } }
              shippingAddress { countryCode }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges {
                  node {
                    sku
                    title
                    variantTitle
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    discountedUnitPriceSet { shopMoney { amount } }
                  }
                }
              }
              refunds {
                createdAt
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                      lineItem { sku }
                    }
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
        const data = this.graphql.query(buildQuery(cursor));
        const orders = data.orders.edges || [];

        for (const edge of orders) {
          const o = edge.node;
          const orderId = o.id;
          const createdAt = o.createdAt;
          const country = o.shippingAddress?.countryCode || "Unknown";
          const taxesIncluded = o.taxesIncluded || false;

          // 💰 Beregn den samlede momssats for ordren
          let orderTaxRate = 0;
          if (taxesIncluded) {
            const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
            const subtotal = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || 0);
            
            if (subtotal > 0) {
              // Momssats = total moms / (subtotal - total moms)
              // Fordi subtotal i Shopify inkluderer moms når taxesIncluded=true
              orderTaxRate = totalTax / (subtotal - totalTax);
            }
          }

          const refundMap = {};
          let latestRefund = "";

          o.refunds.forEach(refund => {
            if (refund.createdAt > latestRefund) latestRefund = refund.createdAt;
            refund.refundLineItems.edges.forEach(e => {
              const sku = (e.node.lineItem?.sku || "").trim().toUpperCase();
              if (sku) {
                refundMap[sku] = (refundMap[sku] || 0) + (e.node.quantity || 0);
              }
            });
          });

          o.lineItems.edges.forEach(li => {
            const node = li.node;
            const sku = (node.sku || "NO_SKU").trim().toUpperCase();
            const key = `${this.shop.domain}|${orderId}|${sku}`;

            if (!existingKeys.has(key)) {
              const qty = node.quantity || 0;
              const refundedQty = refundMap[sku] || 0;
              
              // Hent pris inklusive moms
              const unitPriceIncVat = parseFloat(
                node.discountedUnitPriceSet?.shopMoney?.amount || 
                node.originalUnitPriceSet?.shopMoney?.amount || 0
              );

              // Beregn pris eksklusive moms baseret på ordrens momssats
              let unitPriceExVat = unitPriceIncVat;
              
              if (taxesIncluded && orderTaxRate > 0) {
                // Konverter fra inklusive til eksklusive moms
                unitPriceExVat = unitPriceIncVat / (1 + orderTaxRate);
              }

              const totalPriceExVat = unitPriceExVat * qty;
              const price = totalPriceExVat * this.rate;

              rows.push([
                this.shop.domain,
                orderId,
                createdAt.slice(0, 10),
                country,
                sku,
                node.title || "",
                node.variantTitle || "",
                qty,
                refundedQty,
                price,
                latestRefund || ""
              ]);

              existingKeys.add(key);
            }
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = orders[orders.length - 1].cursor;
        sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      Logger.log(`💥 [${this.shop.domain}] Fejl i fetchSkuDataUpdated: ${err.message}`);
    }

    return rows;
  }
}

function testNewPricing() {
  Logger.log("🧪 Tester ny momsberegning...");
  
  // Slet eksisterende cache
  clearAllCaches();
  
  // Cache én måned
  const now = new Date();
  const oneMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  
  cacheSkuData(oneMonth, now);
  
  Logger.log("✅ Test fuldført - tjek _SKU_CACHE kolonne J for priser eksklusive moms");
}