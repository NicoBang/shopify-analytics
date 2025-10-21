-- Add "fulfillments" to bulk_sync_jobs.object_type check constraint

-- Drop existing constraint
ALTER TABLE bulk_sync_jobs 
DROP CONSTRAINT IF EXISTS bulk_sync_jobs_object_type_check;

-- Add new constraint with "fulfillments" included
ALTER TABLE bulk_sync_jobs
ADD CONSTRAINT bulk_sync_jobs_object_type_check
CHECK (object_type IN ('orders', 'skus', 'refunds', 'shipping-discounts', 'fulfillments'));

-- Add comment
COMMENT ON CONSTRAINT bulk_sync_jobs_object_type_check ON bulk_sync_jobs 
IS 'Allowed sync object types: orders, skus, refunds, shipping-discounts, fulfillments';
