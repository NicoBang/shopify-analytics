-- Migration: Drop verification table after successful merge
-- Purpose: Clean up temporary verification table
-- Date: 2025-10-07
-- WARNING: Only run this after confirming merge was successful!

-- Drop the verification table
DROP TABLE IF EXISTS sku_price_verification;

-- Confirmation message
DO $$
BEGIN
  RAISE NOTICE '✅ Verification table dropped successfully';
  RAISE NOTICE '   Make sure you verified the merge results before running this!';
END $$;
