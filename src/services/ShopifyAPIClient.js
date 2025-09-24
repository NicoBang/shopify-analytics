// src/services/ShopifyAPIClient.js
const axios = require('axios');
const { CONFIG } = require('../config');

class ShopifyAPIClient {
  constructor(shop) {
    this.shop = shop;
    this.endpoint = `https://${shop.domain}/admin/api/${CONFIG.API_VERSION}/graphql.json`;
    this.headers = {
      'X-Shopify-Access-Token': shop.token,
      'Content-Type': 'application/json'
    };
    this.rate = shop.rate || 1;
  }

  // GraphQL query funktion med retry logic
  async query(queryString, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          this.endpoint,
          { query: queryString },
          { headers: this.headers }
        );

        // Check for GraphQL errors
        if (response.data.errors) {
          const errorMessages = response.data.errors.map(e => e.message).join(', ');
          
          // Check if it's a throttling error
          const isThrottled = response.data.errors.some(e => 
            e.message && (
              e.message.includes('Throttled') || 
              e.message.includes('Too many requests') ||
              e.message.includes('rate limit')
            )
          );
          
          if (isThrottled && attempt < retries) {
            console.log(`🔄 Throttled på ${this.shop.domain}. Venter før næste forsøg...`);
            await this.sleep(Math.pow(2, attempt) * 1000);
            continue;
          }
          
          throw new Error(`GraphQL fejl (${this.shop.domain}): ${errorMessages}`);
        }

        // Success!
        return response.data.data;
        
      } catch (error) {
        // Handle rate limiting (429)
        if (error.response?.status === 429 && attempt < retries) {
          const retryAfter = error.response.headers['retry-after'] || 2;
          console.log(`⏱️ Rate limited på ${this.shop.domain}. Venter ${retryAfter} sekunder...`);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Last attempt failed
        if (attempt === retries) {
          console.log(`❌ Fejl efter ${retries} forsøg på ${this.shop.domain}: ${error.message}`);
          throw error;
        }

        // Exponential backoff
        console.log(`🔁 Fejl i forsøg ${attempt}/${retries} på ${this.shop.domain}. Prøver igen...`);
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  // Sleep helper function
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test connection funktion
  async testConnection() {
    const query = `
      query {
        shop {
          name
          currencyCode
        }
      }
    `;
    
    try {
      const data = await this.query(query);
      return data.shop;
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  // FETCH ORDERS FUNKTION - INDE I KLASSEN!
  async fetchOrders(startDate, endDate) {
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
              cancelledAt
              cancelReason
              shippingAddress { countryCode }
              currentTotalPriceSet { shopMoney { amount } }
              subtotalPriceSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              originalTotalPriceSet { shopMoney { amount } }
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
                    quantity
                    fulfillableQuantity
                    currentQuantity
                  }
                }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                      subtotalSet { shopMoney { amount } }
                      lineItem {
                        id
                        sku
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
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const o = edge.node;

          // Udregn fragt ekskl. moms
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

          // Analyser refunds for at skelne mellem cancellations og faktiske refunds
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
                const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0);
                const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
                if (cancelledItemValue > 0 && subtotal > 0 && totalTax > 0) {
                  // Beregn faktisk momssats fra ordren
                  const effectiveTaxRate = totalTax / subtotal;
                  const cancelledItemTax = cancelledItemValue * effectiveTaxRate;
                  totalCancelledTax += cancelledItemTax;
                }
              });
            }
          });

          // Beregn værdier
          const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0);
          const totalTax = parseFloat(o.totalTaxSet?.shopMoney?.amount || 0);
          const totalDiscountsInclTax = parseFloat(o.totalDiscountsSet?.shopMoney?.amount || 0);

          // Beregn rabat ekskl. moms
          let totalDiscountsExTax = totalDiscountsInclTax;
          if (subtotal > 0 && totalTax > 0) {
            const shippingTax = shippingExVat * 0.25;
            const productTax = totalTax - shippingTax;
            const productSubtotalExTax = subtotal - productTax;

            if (productSubtotalExTax > 0) {
              const taxRateOnProducts = productTax / productSubtotalExTax;
              totalDiscountsExTax = totalDiscountsInclTax / (1 + taxRateOnProducts);
            }
          }

          // Beregn sale discount og combined discount
          const originalTotal = parseFloat(o.originalTotalPriceSet?.shopMoney?.amount || 0);
          const currentTotal = parseFloat(o.currentTotalPriceSet?.shopMoney?.amount || 0);
          const saleDiscountTotal = (originalTotal - currentTotal) * this.rate;
          const combinedDiscountTotal = (totalDiscountsInclTax + saleDiscountTotal) * this.rate;

          // Tilføj til output array
          output.push({
            orderId: o.id,
            createdAt: o.createdAt,
            country: o.shippingAddress?.countryCode || "Unknown",
            discountedTotal: subtotal * this.rate,
            tax: totalTax * this.rate,
            shipping: shippingExVat * this.rate,
            itemCount: o.lineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0),
            refundedAmount: totalRefundedAmount * this.rate,
            refundedQty: totalRefundedQty,
            refundDate: lastRefundDate,
            totalDiscountsExTax: totalDiscountsExTax * this.rate,
            cancelledQty: totalCancelledQty,  // Nu bruger vi den korrekte værdi
            saleDiscountTotal: saleDiscountTotal,
            combinedDiscountTotal: combinedDiscountTotal
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;
        
        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchOrders: ${err.message}`);
    }

    return output;
  }

  // FETCH SKU DATA FUNKTION
  async fetchSkuData(startDate, endDate, excludeSkus = new Set()) {
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
              cancelledAt
              shippingAddress { countryCode }
              lineItems(first: ${CONFIG.MAX_LINE_ITEMS}) {
                edges {
                  node {
                    sku
                    product { title }
                    title
                    quantity
                    currentQuantity
                    fulfillableQuantity
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
                      lineItem { sku }
                      quantity
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
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const orderId = order.id;
          const country = order.shippingAddress?.countryCode || "Unknown";

          // Process line items
          order.lineItems.edges.forEach(lineItemEdge => {
            const item = lineItemEdge.node;
            if (!item.sku || excludeSkus.has(item.sku)) return;

            // Calculate refunded quantity for this SKU
            let refundedQty = 0;
            let lastRefundDate = "";

            order.refunds.forEach(refund => {
              refund.refundLineItems.edges.forEach(refundEdge => {
                if (refundEdge.node.lineItem?.sku === item.sku) {
                  refundedQty += refundEdge.node.quantity || 0;
                  if (refund.createdAt > lastRefundDate) {
                    lastRefundDate = refund.createdAt;
                  }
                }
              });
            });

            // Calculate cancelled quantity for this SKU
            let cancelledQty = 0;
            if (order.cancelledAt) {
              // If the entire order is cancelled, all items are cancelled
              cancelledQty = item.quantity || 0;
            } else {
              // Calculate based on difference between original and current quantity
              const totalQty = item.quantity || 0;
              const currentQty = item.currentQuantity || 0;
              // Cancelled quantity is original minus current (but not including refunded)
              cancelledQty = Math.max(0, totalQty - currentQty - refundedQty);
            }

            // Calculate price in DKK
            const unitPrice = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || 0);
            const priceDkk = unitPrice * this.rate;

            output.push({
              shop: this.shop.domain,
              order_id: orderId,
              sku: item.sku,
              created_at: order.createdAt,
              country: country,
              product_title: item.product?.title || "",
              variant_title: item.title || "",
              quantity: item.quantity || 0,
              refunded_qty: refundedQty,
              cancelled_qty: cancelledQty,
              price_dkk: priceDkk,
              refund_date: lastRefundDate || null
            });
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchSkuData: ${err.message}`);
    }

    return output;
  }

  // FETCH INVENTORY FUNKTION
  async fetchInventory() {
    const output = [];
    let cursor = null;

    const buildQuery = (cursorVal) => `
      query {
        productVariants(first: 250${cursorVal ? `, after: "${cursorVal}"` : ""}) {
          edges {
            cursor
            node {
              sku
              inventoryQuantity
              product {
                title
                status
              }
              title
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        const data = await this.query(buildQuery(cursor));
        const edges = data.productVariants.edges || [];

        edges.forEach(edge => {
          const variant = edge.node;
          if (variant.sku) {
            output.push({
              sku: variant.sku,
              quantity: variant.inventoryQuantity || 0,
              productTitle: variant.product?.title || "",
              variantTitle: variant.title || "",
              status: variant.product?.status || "ACTIVE"
            });
          }
        });

        if (!data.productVariants.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchInventory: ${err.message}`);
    }

    return output;
  }

  // FETCH FULFILLMENTS FUNKTION
  async fetchFulfillments(startDate, endDate) {
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
              shippingAddress { countryCode }
              fulfillments {
                createdAt
                trackingCompany
                lineItems(first: 100) {
                  edges {
                    node {
                      quantity
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
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;

          order.fulfillments.forEach(fulfillment => {
            const itemCount = fulfillment.lineItems.edges.reduce(
              (sum, lineItem) => sum + (lineItem.node.quantity || 0),
              0
            );

            output.push({
              orderId: order.id,
              date: fulfillment.createdAt,
              country: order.shippingAddress?.countryCode || "Unknown",
              carrier: fulfillment.trackingCompany || "Unknown",
              itemCount: itemCount
            });
          });
        }

        if (!data.orders.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;

        // Rate limiting
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }

    } catch (err) {
      console.log(`💥 Fejl i fetchFulfillments: ${err.message}`);
    }

    return output;
  }

} // <-- SLUT på klassen

// Export klassen
module.exports = ShopifyAPIClient;