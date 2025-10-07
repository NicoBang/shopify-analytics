-- Create function to find duplicate SKUs
-- Returns list of duplicate SKU IDs that should be deleted (keeps newest per group)
CREATE OR REPLACE FUNCTION find_duplicate_skus()
RETURNS TABLE (
  id UUID,
  order_id BIGINT,
  sku TEXT,
  created_at DATE,
  refund_date DATE,
  row_number BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH duplicates AS (
    SELECT
      s.id,
      s.order_id,
      s.sku,
      s.created_at,
      s.refund_date,
      ROW_NUMBER() OVER (
        PARTITION BY s.order_id, s.sku
        ORDER BY
          s.created_at DESC NULLS LAST,
          CASE WHEN s.refund_date IS NOT NULL THEN 1 ELSE 0 END DESC,
          s.id DESC
      ) AS rn
    FROM skus s
  )
  SELECT
    d.id,
    d.order_id,
    d.sku,
    d.created_at,
    d.refund_date,
    d.rn
  FROM duplicates d
  WHERE d.rn > 1
  ORDER BY d.order_id, d.sku, d.rn;
END;
$$ LANGUAGE plpgsql;

-- Create function to delete duplicate SKUs
-- Keeps the newest row (based on created_at DESC, then refund_date presence, then id DESC) for each (order_id, sku) group
CREATE OR REPLACE FUNCTION delete_duplicate_skus()
RETURNS VOID AS $$
BEGIN
  WITH duplicates AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY order_id, sku
        ORDER BY
          created_at DESC NULLS LAST,
          CASE WHEN refund_date IS NOT NULL THEN 1 ELSE 0 END DESC,
          id DESC
      ) AS rn
    FROM skus
  )
  DELETE FROM skus
  WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
  );
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON FUNCTION find_duplicate_skus() IS 'Finds duplicate SKUs based on (order_id, sku) - keeps row with newest created_at, preferring rows with refund_date if tied';
COMMENT ON FUNCTION delete_duplicate_skus() IS 'Deletes duplicate SKUs, keeping the newest row per group based on (created_at DESC, refund_date presence, id DESC)';
