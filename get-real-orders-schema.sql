-- Get the ACTUAL orders table columns from database
-- Run this in Supabase SQL Editor to see real schema

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
ORDER BY ordinal_position;

-- Also check if there are any other order-related tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%order%';