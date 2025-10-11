-- Check exact columns in orders table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
ORDER BY ordinal_position;

-- Also check a sample record to see what data exists
SELECT * FROM orders LIMIT 1;