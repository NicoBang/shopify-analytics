-- Migration: Create function to update order-level sale_discount_total from SKUs
-- Purpose: Aggregate sale discount from SKU level to order level
-- Date: 2025-10-07

-- Function to update sale_discount_total and combined_discount_total for orders
CREATE OR REPLACE FUNCTION update_order_sale_discount()
RETURNS void AS $$
BEGIN
  -- Update sale_discount_total by aggregating from skus
  UPDATE orders o
  SET sale_discount_total = COALESCE(
    (
      SELECT SUM(s.sale_discount_total_dkk)
      FROM skus s
      WHERE s.order_id::text = o.order_id::text
        AND s.shop = o.shop
    ), 0
  );

  -- Update combined_discount_total = sale_discount_total + total_discounts_ex_tax
  UPDATE orders
  SET combined_discount_total = COALESCE(sale_discount_total, 0) + COALESCE(total_discounts_ex_tax, 0);

  RAISE NOTICE 'Updated sale_discount_total and combined_discount_total for all orders';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_order_sale_discount() IS 'Aggregates sale_discount_total_dkk from skus table to orders.sale_discount_total and updates combined_discount_total';

-- Create a function to update a single order's sale discount
CREATE OR REPLACE FUNCTION update_order_sale_discount_by_id(p_shop text, p_order_id text)
RETURNS void AS $$
BEGIN
  -- Update sale_discount_total by aggregating from skus for specific order
  UPDATE orders o
  SET sale_discount_total = COALESCE(
    (
      SELECT SUM(s.sale_discount_total_dkk)
      FROM skus s
      WHERE s.order_id = p_order_id
        AND s.shop = p_shop
    ), 0
  ),
  combined_discount_total = COALESCE(
    (
      SELECT SUM(s.sale_discount_total_dkk)
      FROM skus s
      WHERE s.order_id = p_order_id
        AND s.shop = p_shop
    ), 0
  ) + COALESCE(o.total_discounts_ex_tax, 0)
  WHERE o.order_id = p_order_id
    AND o.shop = p_shop;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_order_sale_discount_by_id(text, text) IS 'Updates sale_discount_total and combined_discount_total for a specific order';
