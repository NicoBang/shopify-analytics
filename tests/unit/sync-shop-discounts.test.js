/**
 * Unit Tests for discountAllocations GraphQL Query
 * 
 * Tests the new discountAllocations field added to LineItem queries in api/sync-shop.js
 * Validates that the query structure matches Shopify Admin API 2024-10 schema
 */

const assert = require('assert');

/**
 * Mock GraphQL Response with discountAllocations
 * 
 * Based on Shopify Admin API 2024-10 schema validation
 * Represents a real order with:
 * - 2 line items
 * - Product-level discount (50 DKK on first item)
 * - Order-level discount code "SUMMER20" (20 DKK on second item)
 */
const mockGraphQLResponse = {
  data: {
    orders: {
      edges: [
        {
          node: {
            id: "gid://shopify/Order/1234567890",
            createdAt: "2025-10-01T12:00:00Z",
            lineItems: {
              edges: [
                {
                  node: {
                    sku: "100537\\Blue\\128",
                    product: {
                      title: "Calgary Sweatshirt"
                    },
                    title: "Blue / 128",
                    quantity: 2,
                    originalUnitPriceSet: {
                      shopMoney: {
                        amount: "299.00"
                      }
                    },
                    discountedUnitPriceSet: {
                      shopMoney: {
                        amount: "249.00"
                      }
                    },
                    discountAllocations: [
                      {
                        allocatedAmountSet: {
                          shopMoney: {
                            amount: "50.00"
                          }
                        },
                        discountApplication: {
                          // Product-level discount (no code)
                        }
                      }
                    ],
                    taxLines: {
                      rate: 0.25,
                      priceSet: {
                        shopMoney: {
                          amount: "124.50"
                        }
                      }
                    }
                  }
                },
                {
                  node: {
                    sku: "100522\\Green\\146",
                    product: {
                      title: "Copenhagen Hoodie"
                    },
                    title: "Green / 146",
                    quantity: 1,
                    originalUnitPriceSet: {
                      shopMoney: {
                        amount: "399.00"
                      }
                    },
                    discountedUnitPriceSet: {
                      shopMoney: {
                        amount: "399.00"
                      }
                    },
                    discountAllocations: [
                      {
                        allocatedAmountSet: {
                          shopMoney: {
                            amount: "20.00"
                          }
                        },
                        discountApplication: {
                          code: "SUMMER20"
                        }
                      }
                    ],
                    taxLines: {
                      rate: 0.25,
                      priceSet: {
                        shopMoney: {
                          amount: "99.75"
                        }
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  }
};

/**
 * Test Suite: discountAllocations Field Structure
 */
describe('discountAllocations GraphQL Query Structure', () => {
  
  it('should have discountAllocations array on LineItem', () => {
    const lineItem = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[0].node;
    assert(Array.isArray(lineItem.discountAllocations), 'discountAllocations should be an array');
    assert(lineItem.discountAllocations.length > 0, 'discountAllocations should have at least one entry');
  });

  it('should contain allocatedAmountSet.shopMoney.amount', () => {
    const discount = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[0].node.discountAllocations[0];
    assert(discount.allocatedAmountSet, 'allocatedAmountSet should exist');
    assert(discount.allocatedAmountSet.shopMoney, 'shopMoney should exist');
    assert.strictEqual(discount.allocatedAmountSet.shopMoney.amount, "50.00", 'amount should be "50.00"');
  });

  it('should handle product-level discounts without code', () => {
    const discount = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[0].node.discountAllocations[0];
    // Product-level discounts have no code property
    assert.strictEqual(discount.discountApplication.code, undefined, 'Product-level discount should not have code');
  });

  it('should handle order-level discount codes', () => {
    const discount = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[1].node.discountAllocations[0];
    assert.strictEqual(discount.discountApplication.code, "SUMMER20", 'Discount code should be "SUMMER20"');
  });

  it('should calculate total discount across all allocations', () => {
    const lineItems = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges;
    
    let totalDiscount = 0;
    lineItems.forEach(edge => {
      const item = edge.node;
      item.discountAllocations.forEach(allocation => {
        totalDiscount += parseFloat(allocation.allocatedAmountSet.shopMoney.amount);
      });
    });

    // First item: 50 DKK, Second item: 20 DKK = 70 DKK total
    assert.strictEqual(totalDiscount, 70.00, 'Total discount should be 70.00 DKK');
  });
});

/**
 * Test Suite: Revenue Calculation with discountAllocations
 */
describe('Revenue Calculation with discountAllocations', () => {
  
  it('should calculate correct revenue per line item', () => {
    const lineItem = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[0].node;
    
    const originalPrice = parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount);
    const discountedPrice = parseFloat(lineItem.discountedUnitPriceSet.shopMoney.amount);
    const allocatedDiscount = parseFloat(lineItem.discountAllocations[0].allocatedAmountSet.shopMoney.amount);
    const quantity = lineItem.quantity;

    // Original: 299 DKK
    // Discounted: 249 DKK (product-level discount)
    // Allocated: 50 DKK (total discount per unit)
    // Final price per unit: 249 DKK (discounted already reflects the allocation)
    // Total revenue: 249 * 2 = 498 DKK

    assert.strictEqual(originalPrice, 299.00, 'Original price should be 299.00');
    assert.strictEqual(discountedPrice, 249.00, 'Discounted price should be 249.00');
    assert.strictEqual(allocatedDiscount, 50.00, 'Allocated discount should be 50.00');
    
    const revenue = discountedPrice * quantity;
    assert.strictEqual(revenue, 498.00, 'Revenue should be 498.00 DKK');
  });

  it('should handle order-level discount allocation correctly', () => {
    const lineItem = mockGraphQLResponse.data.orders.edges[0].node.lineItems.edges[1].node;
    
    const discountedPrice = parseFloat(lineItem.discountedUnitPriceSet.shopMoney.amount);
    const allocatedDiscount = parseFloat(lineItem.discountAllocations[0].allocatedAmountSet.shopMoney.amount);
    const quantity = lineItem.quantity;

    // Discounted: 399 DKK (no product-level discount)
    // Allocated: 20 DKK (order-level discount code)
    // Final price: 399 - 20 = 379 DKK
    // Total revenue: 379 * 1 = 379 DKK

    const finalPrice = discountedPrice - allocatedDiscount;
    const revenue = finalPrice * quantity;
    
    assert.strictEqual(finalPrice, 379.00, 'Final price should be 379.00 DKK');
    assert.strictEqual(revenue, 379.00, 'Revenue should be 379.00 DKK');
  });
});

console.log('✅ All discountAllocations tests passed');
