// api/sync-shop.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Inline configuration for Vercel
const CONFIG = {
  SHOPS: [
    { domain: "pompdelux-da.myshopify.com", token: process.env.SHOPIFY_TOKEN_DA, currency: 'DKK', rate: 1.0 },
    { domain: "pompdelux-de.myshopify.com", token: process.env.SHOPIFY_TOKEN_DE, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-nl.myshopify.com", token: process.env.SHOPIFY_TOKEN_NL, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-int.myshopify.com", token: process.env.SHOPIFY_TOKEN_INT, currency: 'EUR', rate: 7.46 },
    { domain: "pompdelux-chf.myshopify.com", token: process.env.SHOPIFY_TOKEN_CHF, currency: 'CHF', rate: 6.84 }
  ],
  CUTOFF_DATE: new Date('2024-09-30'),
  CHUNK_DAYS: 30,
  MAX_ORDERS_PER_PAGE: 50, // Reduced from 250 to avoid 414 Request-URI Too Large errors
  MAX_LINE_ITEMS: 100,
  RATE_LIMIT_MS: 250,
  API_VERSION: '2024-10'
};

// Inline ShopifyAPIClient for Vercel
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

  async query(queryString, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          this.endpoint,
          { query: queryString },
          { headers: this.headers }
        );

        if (response.data.errors) {
          throw new Error(response.data.errors[0].message);
        }

        return response.data.data;
      } catch (error) {
        if (error.response?.status === 429 && attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }

        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // Sleep helper function
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testConnection() {
    const query = `query { shop { name currencyCode } }`;
    const data = await this.query(query);
    return data.shop;
  }

  // FETCH ORDERS FUNKTION
  async fetchOrders(startDate, endDate, useUpdatedAt = false) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const dateField = useUpdatedAt ? 'updated_at' : 'created_at';
    const queryFilter = `${dateField}:>=${isoStart} ${dateField}:<=${isoEnd}`;
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
                edges { node { quantity } }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      quantity
                    }
                  }
                }
                transactions(first: 1) {
                  edges {
                    node {
                      processedAt
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
        const queryStr = buildQuery(cursor);
        console.log(`🔍 Query filter: ${queryFilter}`);
        console.log(`🔍 Full query (first 500 chars):`, queryStr.substring(0, 500));

        const data = await this.query(queryStr);
        console.log(`📊 Shopify orders response:`, {
          query: queryFilter,
          edgeCount: data.orders?.edges?.length || 0,
          hasNextPage: data.orders?.pageInfo?.hasNextPage
        });
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

          // Beregn refund info - separer faktiske refunds fra cancellations
          let totalRefundedAmount = 0;
          let totalRefundedQty = 0;
          let totalCancelledQty = 0;
          let lastRefundDate = "";

          o.refunds.forEach(r => {
            const refundTotal = parseFloat(r.totalRefundedSet?.shopMoney?.amount || 0);
            totalRefundedAmount += refundTotal;

            // Calculate total quantity FIRST
            const refundQty = r.refundLineItems.edges.reduce((sum, e) => sum + (e.node.quantity || 0), 0);

            // Then check refund total ONCE
            if (refundTotal > 0) {
              totalRefundedQty += refundQty;
              const refundDate = (r.transactions?.edges?.[0]?.node?.processedAt)
                ? r.transactions.edges[0].node.processedAt
                : r.createdAt;
              if (refundDate > lastRefundDate) {
                lastRefundDate = refundDate;
              }
            } else {
              totalCancelledQty += refundQty;
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
            orderId: o.id.replace('gid://shopify/Order/', ''),
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
            cancelledQty: totalCancelledQty,
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
  async fetchSkuData(startDate, endDate, useUpdatedAt = false, excludeSkus = new Set()) {
    const isoStart = startDate.toISOString();
    const isoEnd = endDate.toISOString();
    const dateField = useUpdatedAt ? 'updated_at' : 'created_at';
    const queryFilter = `${dateField}:>=${isoStart} ${dateField}:<=${isoEnd}`;
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
              taxesIncluded
              shippingAddress { countryCode }
              subtotalPriceSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              originalTotalPriceSet { shopMoney { amount } }
              currentTotalPriceSet { shopMoney { amount } }
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
                    sku
                    product { title }
                    title
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    discountedUnitPriceSet { shopMoney { amount } }
                    taxLines {
                      priceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                  }
                }
              }
              refunds {
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 100) {
                  edges {
                    node {
                      lineItem { sku }
                      quantity
                      priceSet { shopMoney { amount } }
                    }
                  }
                }
                transactions(first: 1) {
                  edges {
                    node {
                      processedAt
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
          const orderId = order.id.replace('gid://shopify/Order/', '');
          const country = order.shippingAddress?.countryCode || "Unknown";
          const taxesIncluded = order.taxesIncluded || false;

          // Calculate order-level discount info (same logic as fetchOrders)
          const subtotal = parseFloat(order.subtotalPriceSet?.shopMoney?.amount || 0);
          const totalTax = parseFloat(order.totalTaxSet?.shopMoney?.amount || 0);
          const totalDiscountsInclTax = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

          // Calculate shipping tax to separate product tax
          const shippingLines = order.shippingLines?.edges || [];
          let shippingExVat = 0;
          shippingLines.forEach(line => {
            const gross = parseFloat(line.node.price || 0);
            const tax = (line.node.taxLines || []).reduce(
              (sum, tl) => sum + parseFloat(tl.price || 0),
              0
            );
            shippingExVat += gross - tax;
          });

          // Calculate discount ex tax (same as orders table)
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

          // Calculate sale discount
          const originalTotal = parseFloat(order.originalTotalPriceSet?.shopMoney?.amount || 0);
          const currentTotal = parseFloat(order.currentTotalPriceSet?.shopMoney?.amount || 0);
          const saleDiscountTotal = originalTotal - currentTotal;

          // Combined discount total
          const combinedDiscountTotal = totalDiscountsInclTax + saleDiscountTotal;

          // Calculate total order value (discounted prices) for proportional allocation
          let orderTotalDiscountedValue = 0;
          order.lineItems.edges.forEach(lineItemEdge => {
            const item = lineItemEdge.node;
            if (!item.sku || excludeSkus.has(item.sku)) return;
            const unitPrice = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || 0);
            const quantity = item.quantity || 0;
            orderTotalDiscountedValue += unitPrice * quantity;
          });

          // Process line items
          order.lineItems.edges.forEach(lineItemEdge => {
            const item = lineItemEdge.node;
            if (!item.sku || excludeSkus.has(item.sku)) return;

            // Calculate refunded and cancelled quantities for this SKU
            let refundedQty = 0;
            let cancelledQty = 0;
            let lastRefundDate = "";

            order.refunds.forEach(refund => {
              const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount || 0);

              // Calculate total quantity for this SKU in this refund FIRST
              const skuRefundQty = refund.refundLineItems.edges
                .filter(e => e.node.lineItem?.sku === item.sku)
                .reduce((sum, e) => sum + (e.node.quantity || 0), 0);

              // Then check refund total ONCE
              if (skuRefundQty > 0) {
                if (refundTotal > 0) {
                  refundedQty += skuRefundQty;
                  const refundDate = (refund.transactions?.edges?.[0]?.node?.processedAt)
                    ? refund.transactions.edges[0].node.processedAt
                    : refund.createdAt;
                  if (refundDate > lastRefundDate) {
                    lastRefundDate = refundDate;
                  }
                } else {
                  cancelledQty += skuRefundQty;
                }
              }
            });

            // Calculate price in DKK (EX MOMS)
            // CRITICAL: discountedUnitPriceSet includes/excludes tax based on order.taxesIncluded
            const unitPrice = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || 0);
            const quantity = item.quantity || 0;

            // Get line item tax
            const lineTax = (item.taxLines || []).reduce(
              (sum, tl) => sum + parseFloat(tl.priceSet?.shopMoney?.amount || 0),
              0
            );

            // Calculate EX moms price
            let unitPriceExTax;
            if (taxesIncluded) {
              // Prices include tax - subtract tax to get EX moms
              unitPriceExTax = unitPrice - (lineTax / quantity);
            } else {
              // Prices exclude tax - use directly
              unitPriceExTax = unitPrice;
            }

            const priceDkk = unitPriceExTax * this.rate;

            // Calculate line total INCL tax for proportional discount allocation
            const lineTotalInclTax = (unitPriceExTax + (lineTax / quantity)) * quantity;

            // Allocate order-level discount proportionally
            // combinedDiscountTotal is INCL moms, so we need to calculate the EX moms portion
            let totalDiscountDkk = 0;
            let discountPerUnitDkk = 0;

            if (orderTotalDiscountedValue > 0 && combinedDiscountTotal > 0) {
              // Line's share of total order value (INCL tax for accurate allocation)
              const lineShareOfOrder = lineTotalInclTax / orderTotalDiscountedValue;
              const allocatedDiscountInclTax = combinedDiscountTotal * lineShareOfOrder;

              // Calculate tax portion of allocated discount
              const taxRate = lineTax / (unitPriceExTax * quantity);
              const allocatedDiscountExTax = allocatedDiscountInclTax / (1 + taxRate);

              totalDiscountDkk = allocatedDiscountExTax * this.rate;
              discountPerUnitDkk = quantity > 0 ? totalDiscountDkk / quantity : 0;
            }

            output.push({
              shop: this.shop.domain,
              order_id: orderId,
              sku: item.sku,
              created_at: order.createdAt,
              country: country,
              product_title: item.product?.title || "",
              variant_title: item.title || "",
              quantity: quantity,
              refunded_qty: refundedQty,
              cancelled_qty: cancelledQty,
              price_dkk: priceDkk,
              refund_date: lastRefundDate || null,
              total_discount_dkk: totalDiscountDkk,
              discount_per_unit_dkk: discountPerUnitDkk
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

  // FETCH FULFILLMENTS FUNKTION - FIXED to match working old implementation
  async fetchFulfillments(startDate, endDate) {
    const output = [];
    let cursor = null;

    // FIXED: Search broader for orders and filter fulfillments on their createdAt
    // Extend search window to include orders from 30 days before startDate (reduced from 90 to avoid 414 errors)
    const orderSearchStart = new Date(startDate);
    orderSearchStart.setDate(orderSearchStart.getDate() - 30);

    const isoOrderStart = orderSearchStart.toISOString();
    const isoEnd = endDate.toISOString();
    const queryFilter = `fulfillment_status:fulfilled created_at:>=${isoOrderStart} created_at:<=${isoEnd}`;

    console.log(`🔍 fetchFulfillments: Søger ordrer fra ${orderSearchStart.toISOString().slice(0,10)} til ${endDate.toISOString().slice(0,10)}, filtrerer fulfillments ${startDate.toISOString().slice(0,10)}-${endDate.toISOString().slice(0,10)}`);

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
        const data = await this.query(buildQuery(cursor));
        const edges = data.orders.edges || [];

        for (const edge of edges) {
          const order = edge.node;
          const country = order.shippingAddress?.countryCode || "Unknown";

          order.fulfillments.forEach(f => {
            const created = new Date(f.createdAt);
            // FIXED: Only include fulfillments that were actually shipped in target date interval
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
        await this.sleep(CONFIG.RATE_LIMIT_MS);
      }
    } catch (err) {
      console.log(`💥 [${this.shop.domain}] Fejl i fetchFulfillments: ${err.message}`);
    }

    console.log(`✅ [${this.shop.domain}] fetchFulfillments: ${output.length} fulfillments fundet`);
    return output;
  }

  // FETCH METADATA FUNKTION - Chunked fetching to avoid timeout
  async fetchMetadata(startCursor = null, maxProducts = 500) {
    const output = [];
    let cursor = startCursor;
    const batchSize = 50; // Reduced for query complexity
    let pageCount = 0;
    let totalFetched = 0;
    let hasMore = false;
    let nextCursor = null;

    console.log(`🇩🇰 Henter metadata (chunked, batch=${batchSize}, max=${maxProducts}, cursor=${startCursor ? 'YES' : 'NO'}): ${this.shop.domain}...`);

    const buildQuery = (cursorVal) => `
      query {
        productVariants(first: ${batchSize}${cursorVal ? `, after: "${cursorVal}"` : ""}) {
          edges {
            cursor
            node {
              sku
              price
              compareAtPrice
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
        const data = await this.query(buildQuery(cursor));
        const edges = data.productVariants.edges || [];
        pageCount++;

        console.log(`📦 Page ${pageCount}: ${edges.length} variants`);

        for (const edge of edges) {
          const variant = edge.node;
          if (!variant.sku) continue;

          // Kombiner product og variant metafields (variant overskriver product)
          const metadata = {};

          // Product metafields først
          variant.product.metafields.edges.forEach(({ node }) => {
            metadata[node.key] = node.value;
          });

          // Variant metafields overskriver product hvis der er overlap
          variant.metafields.edges.forEach(({ node }) => {
            metadata[node.key] = node.value;
          });

          // Hent cost fra inventory item
          const cost = parseFloat(variant.inventoryItem?.unitCost?.amount || 0);

          // Hent price og compareAtPrice
          const price = parseFloat(variant.price) || 0;
          const compareAtPrice = parseFloat(variant.compareAtPrice) || 0;

          // Build output record (produkt/farve excluded - parsed from titles in API layer)
          output.push({
            sku: variant.sku,
            product_title: variant.product.title,
            variant_title: variant.title,
            status: variant.product.status,
            cost: cost,
            program: metadata.program || '',
            artikelnummer: metadata.artikelnummer || variant.sku,
            season: metadata.season || '',
            gender: metadata.gender || '',
            størrelse: metadata.størrelse || '',
            varemodtaget: parseInt(metadata.varemodtaget) || 0,
            kostpris: cost,
            stamvarenummer: metadata.stamvarenummer || metadata['custom.stamvarenummer'] || '',
            tags: (variant.product.tags || []).join(', '),
            price: price,
            compare_at_price: compareAtPrice
          });

          totalFetched++;

          // Stop if we've reached maxProducts limit
          if (totalFetched >= maxProducts) {
            hasMore = data.productVariants.pageInfo.hasNextPage || edges.indexOf(edge) < edges.length - 1;
            nextCursor = edge.cursor;
            break;
          }
        }

        // If we hit the limit mid-batch, stop here
        if (totalFetched >= maxProducts) break;

        // Check if there's more data
        hasMore = data.productVariants.pageInfo.hasNextPage;
        if (!hasMore) break;

        cursor = edges[edges.length - 1].cursor;
        nextCursor = cursor;

        // Increased rate limiting for query complexity
        await this.sleep(500);
      }

      console.log(`✅ fetchMetadata complete: ${output.length} products fetched in ${pageCount} pages`);
      console.log(`📍 Has more: ${hasMore}, Next cursor: ${nextCursor ? 'YES' : 'NO'}`);

      return {
        metadata: output,
        hasMore: hasMore,
        nextCursor: nextCursor
      };
    } catch (err) {
      console.log(`💥 Fejl i fetchMetadata: ${err.message}`);
      throw err;
    }
  }
}

// Inline SupabaseService for Vercel
class SupabaseService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async testConnection() {
    const { data, error } = await this.supabase
      .from('sync_log')
      .select('count')
      .limit(1);

    if (error) throw error;
    return { success: true, message: 'Supabase connection successful' };
  }

  // Insert/update orders
  async upsertOrders(orders) {
    if (!orders || orders.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${orders.length} orders to Supabase...`);

    // Transform orders to match database schema
    const dbOrders = orders.map(order => ({
      shop: order.shop || 'unknown',
      order_id: order.orderId.replace('gid://shopify/Order/', ''),
      created_at: order.createdAt,
      country: order.country,
      discounted_total: order.discountedTotal,
      tax: order.tax,
      shipping: order.shipping,
      item_count: order.itemCount,
      refunded_amount: order.refundedAmount || 0,
      refunded_qty: order.refundedQty || 0,
      refund_date: order.refundDate || null,
      total_discounts_ex_tax: order.totalDiscountsExTax || 0,
      cancelled_qty: order.cancelledQty || 0,
      sale_discount_total: order.saleDiscountTotal || 0,
      combined_discount_total: order.combinedDiscountTotal || 0,
      raw_data: order,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('orders')
      .upsert(dbOrders, {
        onConflict: 'shop,order_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting orders:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${orders.length} orders`);
    return { count: orders.length, data };
  }

  // Insert/update SKUs
  async upsertSkus(skus) {
    if (!skus || skus.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${skus.length} SKUs to Supabase...`);

    const { data, error } = await this.supabase
      .from('skus')
      .upsert(skus, {
        onConflict: 'shop,order_id,sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting SKUs:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${skus.length} SKUs`);
    return { count: skus.length, data };
  }

  // Insert/update fulfillments
  async upsertFulfillments(fulfillments) {
    if (!fulfillments || fulfillments.length === 0) return { count: 0 };

    console.log(`🚚 Upserting ${fulfillments.length} fulfillments to Supabase with robust deduplication...`);

    // Map fulfillments to match database schema (5 columns: order_id, date, country, carrier, item_count)
    const dbFulfillments = fulfillments.map(fulfillment => ({
      order_id: fulfillment.orderId.replace('gid://shopify/Order/', ''), // Clean order ID
      date: new Date(fulfillment.date).toISOString(), // Normalize date format
      country: fulfillment.country,
      carrier: fulfillment.carrier,
      item_count: fulfillment.itemCount
    }));

    // First, clean up existing duplicates in the database for these order_ids
    const orderIds = [...new Set(dbFulfillments.map(f => f.order_id))];
    console.log(`🧹 Cleaning up duplicates for ${orderIds.length} orders...`);

    // For now, skip automatic cleanup and rely on robust deduplication
    // TODO: Add cleanup function later if needed

    // ROBUST DEDUPLICATION: Check for existing fulfillments using ALL fields
    const { data: existing, error: checkError } = await this.supabase
      .from('fulfillments')
      .select('order_id, date, country, carrier, item_count')
      .in('order_id', orderIds);

    if (checkError) {
      console.error('❌ Error checking existing fulfillments:', checkError);
      throw checkError;
    }

    // Create composite keys for both existing and new fulfillments (normalize dates)
    const existingKeys = new Set(
      existing.map(e => `${e.order_id}|${new Date(e.date).toISOString()}|${e.country}|${e.carrier}|${e.item_count}`)
    );

    const newFulfillments = dbFulfillments.filter(f => {
      const key = `${f.order_id}|${f.date}|${f.country}|${f.carrier}|${f.item_count}`;
      return !existingKeys.has(key);
    });

    console.log(`📊 Found ${existingKeys.size} existing fulfillments, inserting ${newFulfillments.length} new fulfillments`);

    if (newFulfillments.length === 0) {
      console.log(`✅ No new fulfillments to insert (all were duplicates)`);
      return { count: 0, data: [] };
    }

    const { data, error } = await this.supabase
      .from('fulfillments')
      .insert(newFulfillments);

    if (error) {
      console.error('❌ Error upserting fulfillments:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${newFulfillments.length} new fulfillments`);
    return { count: newFulfillments.length, data };
  }

  // Update inventory
  async updateInventory(inventory) {
    if (!inventory || inventory.length === 0) return { count: 0 };

    console.log(`📦 Updating ${inventory.length} inventory items...`);

    const dbInventory = inventory.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      last_updated: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('inventory')
      .upsert(dbInventory, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error updating inventory:', error);
      throw error;
    }

    console.log(`✅ Successfully updated ${inventory.length} inventory items`);
    return { count: inventory.length, data };
  }

  // Update product metadata
  async upsertMetadata(metadata) {
    if (!metadata || metadata.length === 0) return { count: 0 };

    console.log(`📋 Upserting ${metadata.length} metadata records to Supabase...`);

    // Helper to convert empty strings to null for numeric fields
    const toNumericOrNull = (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = parseFloat(val);
      return isNaN(num) ? null : num;
    };

    const dbMetadata = metadata.map(item => ({
      sku: item.sku,
      product_title: item.product_title || '',
      variant_title: item.variant_title || '',
      status: item.status || 'ACTIVE',
      cost: toNumericOrNull(item.cost),
      program: item.program || '',
      artikelnummer: item.artikelnummer || item.sku,
      season: item.season || '',
      gender: item.gender || '',
      størrelse: item.størrelse || '',
      varemodtaget: toNumericOrNull(item.varemodtaget),
      kostpris: toNumericOrNull(item.kostpris),
      stamvarenummer: item.stamvarenummer || '',
      tags: item.tags || '',
      price: toNumericOrNull(item.price),
      compare_at_price: toNumericOrNull(item.compare_at_price),
      last_updated: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('product_metadata')
      .upsert(dbMetadata, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting metadata:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${metadata.length} metadata records`);
    return { count: metadata.length, data };
  }

  async logSync(shop, syncType, recordsSynced, errorMessage = null) {
    const logEntry = {
      shop,
      sync_type: syncType,
      records_synced: recordsSynced,
      completed_at: new Date().toISOString(),
      status: errorMessage ? 'failed' : 'completed',
      error_message: errorMessage
    };

    await this.supabase.from('sync_log').insert([logEntry]);
  }
}

// Enable CORS and verify API key
function validateRequest(req, res) {
  // Enable CORS for Google Sheets
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify API key
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }

  return null; // Valid request
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  // Extract parameters
  let { shop: shopDomain, type = 'orders', days = 7, startDate, endDate, updatedMode = 'false' } = req.query;

  // Also support POST body parameters
  if (req.method === 'POST' && req.body) {
    shopDomain = req.body.shop || shopDomain;
    type = req.body.type || type;
    days = req.body.days || days;
    startDate = req.body.startDate || startDate;
    endDate = req.body.endDate || endDate;
    updatedMode = req.body.updatedMode || updatedMode;
  }

  // Convert updatedMode to boolean
  const useUpdatedAt = updatedMode === 'true' || updatedMode === true;

  // Shop domain not required for cleanup operations
  if (!shopDomain && type !== 'cleanup-fulfillments') {
    return res.status(400).json({
      error: 'Missing required parameter: shop domain',
      example: 'pompdelux-da.myshopify.com'
    });
  }

  // Log sync parameters
  if (type === 'cleanup-fulfillments') {
    console.log(`🚀 Starting cleanup: ${type}`);
  } else if (startDate && endDate) {
    console.log(`🚀 Starting sync: ${type} for ${shopDomain} (${startDate} to ${endDate})`);
  } else {
    console.log(`🚀 Starting sync: ${type} for ${shopDomain} (${days} days)`);
  }

  try {
    let shop = null;
    let shopifyClient = null;

    // Find shop configuration (not needed for cleanup)
    if (type !== 'cleanup-fulfillments') {
      shop = CONFIG.SHOPS.find(s => s.domain === shopDomain);
      if (!shop) {
        return res.status(400).json({
          error: 'Invalid shop domain',
          availableShops: CONFIG.SHOPS.map(s => s.domain)
        });
      }

      // Initialize shopify client
      shopifyClient = new ShopifyAPIClient(shop);

      // Test connections
      console.log('🔍 Testing connections...');
      await shopifyClient.testConnection();
    }

    // Initialize Supabase service (always needed)
    const supabaseService = new SupabaseService();
    await supabaseService.testConnection();

    // Calculate date range - support both days and explicit dates (skip for cleanup operations)
    let syncStartDate, syncEndDate;

    if (type !== 'cleanup-fulfillments') {
      if (startDate && endDate) {
        // Use explicit date range
        syncStartDate = new Date(startDate);
        syncEndDate = new Date(endDate);

        // Validate dates
        if (isNaN(syncStartDate.getTime()) || isNaN(syncEndDate.getTime())) {
          return res.status(400).json({
            error: 'Invalid date format. Use YYYY-MM-DD format',
            examples: { startDate: '2024-09-30', endDate: '2024-10-31' }
          });
        }

        if (syncStartDate >= syncEndDate) {
          return res.status(400).json({
            error: 'startDate must be before endDate'
          });
        }
      } else {
        // Use days parameter (backward compatibility)
        syncEndDate = new Date();
        syncStartDate = new Date();
        syncStartDate.setDate(syncStartDate.getDate() - Number(days));
      }
    }

    if (type !== 'cleanup-fulfillments') {
      console.log(`📅 Syncing from ${syncStartDate.toISOString().split('T')[0]} to ${syncEndDate.toISOString().split('T')[0]}`);
    }

    let recordsSynced = 0;
    let syncData = null;

    // Execute sync based on type
    switch (type.toLowerCase()) {
      case 'orders':
        console.log(`📦 Fetching orders (${useUpdatedAt ? 'updated_at' : 'created_at'} mode)...`);
        const orders = await shopifyClient.fetchOrders(syncStartDate, syncEndDate, useUpdatedAt);

        // Add shop domain to each order
        orders.forEach(order => order.shop = shopDomain);

        console.log('💾 Saving to Supabase...');
        const orderResult = await supabaseService.upsertOrders(orders);
        recordsSynced = orderResult.count;
        syncData = { ordersFound: orders.length };
        break;

      case 'skus':
        console.log(`🏷️ Fetching SKU data (${useUpdatedAt ? 'updated_at' : 'created_at'} mode)...`);
        const skus = await shopifyClient.fetchSkuData(syncStartDate, syncEndDate, useUpdatedAt);

        // Deduplikér SKU data INDEN for samme batch
        // Men lad PostgreSQL håndtere opdateringer af eksisterende rækker
        console.log(`📊 Processing ${skus.length} SKUs...`);
        const uniqueSkusMap = skus.reduce((map, item) => {
          const key = `${item.shop}-${item.order_id}-${item.sku}`;
          const existing = map.get(key);

          // Inden for samme batch: behold den nyeste/mest komplette version
          if (!existing) {
            map.set(key, item);
          } else {
            // Prioritér:
            // 1. Post med refund_date (nyeste hvis flere)
            // 2. Post med højeste refunded_qty
            // 3. Behold eksisterende
            if (item.refund_date && (!existing.refund_date || item.refund_date > existing.refund_date)) {
              map.set(key, item);
            } else if (!item.refund_date && !existing.refund_date && item.refunded_qty > existing.refunded_qty) {
              map.set(key, item);
            }
          }

          return map;
        }, new Map());

        const uniqueSkus = Array.from(uniqueSkusMap.values());
        const duplicatesInBatch = skus.length - uniqueSkus.length;

        if (duplicatesInBatch > 0) {
          console.log(`✨ Removed ${duplicatesInBatch} duplicates within batch`);
        }

        console.log('💾 Upserting to Supabase (will update existing records)...');
        const skuResult = await supabaseService.upsertSkus(uniqueSkus);
        recordsSynced = skuResult.count;
        syncData = {
          skusFound: skus.length,
          uniqueSkus: uniqueSkus.length,
          duplicatesRemoved: duplicatesInBatch
        };
        break;

      case 'inventory':
        console.log('📦 Fetching inventory...');
        const inventory = await shopifyClient.fetchInventory();

        console.log('💾 Updating Supabase...');
        const invResult = await supabaseService.updateInventory(inventory);
        recordsSynced = invResult.count;
        syncData = { inventoryItems: inventory.length };
        break;

      case 'fulfillments':
        console.log('🚚 Fetching fulfillments...');
        const fulfillments = await shopifyClient.fetchFulfillments(syncStartDate, syncEndDate);

        console.log(`🚚 Found ${fulfillments.length} fulfillments`);

        console.log('💾 Saving to Supabase...');
        const fulfillmentResult = await supabaseService.upsertFulfillments(fulfillments);
        recordsSynced = fulfillmentResult.count;
        syncData = {
          fulfillmentsFound: fulfillments.length,
          sampleFulfillments: fulfillments.slice(0, 3), // Include første 3 for debugging
          debug: {
            searchPeriod: `${syncStartDate.toISOString()} to ${syncEndDate.toISOString()}`,
            extendedSearchPeriod: `From 90 days before startDate to endDate`
          }
        };
        break;

      case 'metadata':
        // CRITICAL: Metadata sync ONLY from Danish shop (pompdelux-da.myshopify.com)
        if (shopDomain !== 'pompdelux-da.myshopify.com') {
          return res.status(400).json({
            error: 'Metadata sync only allowed from Danish shop',
            allowedShop: 'pompdelux-da.myshopify.com',
            requestedShop: shopDomain
          });
        }

        console.log('📋 Fetching product metadata from Danish shop (chunked)...');

        // Get cursor from query params for continuation
        const startCursor = req.query.cursor || null;
        const maxProducts = parseInt(req.query.maxProducts) || 500;

        // Fetch chunk of metadata
        const result = await shopifyClient.fetchMetadata(startCursor, maxProducts);
        console.log(`✅ Fetched ${result.metadata.length} metadata records`);

        // Upsert this chunk to database
        console.log('💾 Upserting to Supabase...');
        const metadataResult = await supabaseService.upsertMetadata(result.metadata);

        recordsSynced = metadataResult.count;
        syncData = {
          metadataItems: result.metadata.length,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          sampleMetadata: result.metadata.slice(0, 3),
          message: result.hasMore ? `Chunk complete. Call again with cursor=${result.nextCursor}` : 'All metadata synced'
        };
        break;

      case 'cleanup-fulfillments':
        console.log('🧹 Starting fulfillments cleanup (no shop sync needed)...');

        // Get all fulfillments and find duplicates
        let allFulfillments = [];
        let cleanupOffset = 0;
        const cleanupBatchSize = 1000;
        let hasMoreCleanup = true;

        while (hasMoreCleanup) {
          const { data: batch, error: fetchError } = await supabaseService.supabase
            .from('fulfillments')
            .select('id, order_id, date, country, carrier, item_count, created_at')
            .order('created_at')
            .range(cleanupOffset, cleanupOffset + cleanupBatchSize - 1);

          if (fetchError) throw fetchError;

          if (batch && batch.length > 0) {
            allFulfillments = allFulfillments.concat(batch);
            hasMoreCleanup = batch.length === cleanupBatchSize;
            cleanupOffset += cleanupBatchSize;
            console.log(`📦 Loaded ${allFulfillments.length} fulfillments for analysis`);
          } else {
            hasMoreCleanup = false;
          }
        }

        // Group by composite key and find duplicates
        const groups = new Map();
        allFulfillments.forEach(f => {
          const key = `${f.order_id}|${f.date}|${f.country}|${f.carrier}|${f.item_count}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(f);
        });

        // Find duplicates to delete (keep first, delete rest)
        const toDelete = [];
        groups.forEach(fulfillments => {
          if (fulfillments.length > 1) {
            fulfillments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            for (let i = 1; i < fulfillments.length; i++) {
              toDelete.push(fulfillments[i].id);
            }
          }
        });

        console.log(`🗑️ Found ${toDelete.length} duplicates to remove`);

        if (toDelete.length > 0) {
          // Delete in batches
          const deleteBatchSize = 1000;
          let deleted = 0;

          for (let i = 0; i < toDelete.length; i += deleteBatchSize) {
            const batch = toDelete.slice(i, i + deleteBatchSize);

            const { error: deleteError } = await supabaseService.supabase
              .from('fulfillments')
              .delete()
              .in('id', batch);

            if (deleteError) throw deleteError;

            deleted += batch.length;
            console.log(`✅ Deleted batch: ${deleted}/${toDelete.length}`);
          }
        }

        recordsSynced = toDelete.length;
        syncData = {
          totalFulfillments: allFulfillments.length,
          duplicatesFound: toDelete.length,
          duplicatesRemoved: toDelete.length,
          uniqueFulfillments: allFulfillments.length - toDelete.length
        };
        break;

      default:
        return res.status(400).json({
          error: 'Invalid sync type',
          validTypes: ['orders', 'skus', 'inventory', 'fulfillments', 'metadata', 'cleanup-fulfillments']
        });
    }

    // Log the sync operation
    console.log('📊 Logging sync operation...');
    await supabaseService.logSync(shopDomain, type, recordsSynced);

    console.log(`✅ Sync completed: ${recordsSynced} records`);

    // Return success response
    return res.status(200).json({
      success: true,
      shop: shopDomain,
      type,
      recordsSynced,
      period: {
        startDate: syncStartDate.toISOString(),
        endDate: syncEndDate.toISOString(),
        days: startDate && endDate ? Math.ceil((syncEndDate - syncStartDate) / (1000 * 60 * 60 * 24)) : Number(days)
      },
      data: syncData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Sync error:', error);

    // Log failed sync
    try {
      const supabaseService = new SupabaseService();
      await supabaseService.logSync(shopDomain, type, 0, error.message);
    } catch (logError) {
      console.error('💥 Error logging failed sync:', logError);
    }

    return res.status(500).json({
      error: error.message,
      shop: shopDomain,
      type,
      timestamp: new Date().toISOString()
    });
  }
};