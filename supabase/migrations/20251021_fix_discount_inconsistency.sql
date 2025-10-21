-- Fix data inconsistency where total_discount_dkk doesn't match discount_per_unit_dkk * quantity
-- This fixes SKU 7612292563211 (20200\122/140) and any other similar cases
-- Bug: total_discount_dkk was incorrectly set to price_dkk value instead of discount_per_unit_dkk * quantity

-- Update all rows where total_discount_dkk doesn't match calculated value
UPDATE skus
SET total_discount_dkk = discount_per_unit_dkk * quantity
WHERE ABS(total_discount_dkk - (discount_per_unit_dkk * quantity)) > 0.01;

-- Verification: Should show 0 rows after fix
SELECT
  order_id,
  sku,
  quantity,
  discount_per_unit_dkk,
  total_discount_dkk,
  (discount_per_unit_dkk * quantity) as calculated_total,
  total_discount_dkk - (discount_per_unit_dkk * quantity) as difference
FROM skus
WHERE (created_at_original AT TIME ZONE 'Europe/Copenhagen')::date = '2025-10-05'
  AND ABS(total_discount_dkk - (discount_per_unit_dkk * quantity)) > 0.01
ORDER BY ABS(total_discount_dkk - (discount_per_unit_dkk * quantity)) DESC;
