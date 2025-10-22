-- Find orders with duplicate fulfillment rows
-- Used by cleanup-duplicate-fulfillments.sh

CREATE OR REPLACE FUNCTION find_duplicate_fulfillments()
RETURNS TABLE (
  shop TEXT,
  order_id TEXT,
  row_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.shop,
    f.order_id,
    COUNT(*) as row_count
  FROM fulfillments f
  GROUP BY f.shop, f.order_id
  HAVING COUNT(*) > 1
  ORDER BY row_count DESC, f.order_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_duplicate_fulfillments IS 'Finds orders with multiple fulfillment rows (duplicates from different sync methods)';
