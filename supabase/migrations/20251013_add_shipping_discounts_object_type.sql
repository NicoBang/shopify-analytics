-- Add shipping-discounts to bulk_sync_jobs object_type constraint
-- This allows shipping discount sync jobs to be tracked in the job queue

-- Drop existing constraint
ALTER TABLE bulk_sync_jobs DROP CONSTRAINT IF EXISTS bulk_sync_jobs_object_type_check;

-- Add new constraint with shipping-discounts included
ALTER TABLE bulk_sync_jobs
ADD CONSTRAINT bulk_sync_jobs_object_type_check
CHECK (object_type IN ('orders', 'skus', 'refunds', 'shipping-discounts'));

-- Verify constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'bulk_sync_jobs'::regclass
  AND conname = 'bulk_sync_jobs_object_type_check';
