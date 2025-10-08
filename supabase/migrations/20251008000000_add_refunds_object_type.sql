-- Add "refunds" as a valid object_type in bulk_sync_jobs table
-- This allows tracking refund sync jobs in the job queue system

-- Drop existing check constraint
ALTER TABLE bulk_sync_jobs
DROP CONSTRAINT IF EXISTS bulk_sync_jobs_object_type_check;

-- Add new check constraint with "refunds" included
ALTER TABLE bulk_sync_jobs
ADD CONSTRAINT bulk_sync_jobs_object_type_check
CHECK (object_type IN ('orders', 'skus', 'both', 'refunds'));
