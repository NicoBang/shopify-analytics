#!/bin/bash

# Cleanup duplicate jobs in bulk_sync_jobs table
# Keeps oldest job for each (shop, start_date, end_date, object_type) combination

KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🧹 Cleaning up duplicate jobs..."
echo ""

# Show duplicates first
echo "📊 Finding duplicates..."
psql "postgresql://postgres.ihawjrtfwysyokfotewn:$KEY@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" -c "
SELECT
  shop,
  start_date,
  end_date,
  object_type,
  COUNT(*) as duplicates
FROM bulk_sync_jobs
GROUP BY shop, start_date, end_date, object_type
HAVING COUNT(*) > 1
ORDER BY start_date DESC
LIMIT 10;
"

echo ""
read -p "Delete duplicates? (y/n): " confirm

if [ "$confirm" != "y" ]; then
  echo "❌ Cancelled"
  exit 0
fi

echo ""
echo "🗑️ Deleting duplicates (keeping oldest)..."

psql "postgresql://postgres.ihawjrtfwysyokfotewn:$KEY@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" -c "
DELETE FROM bulk_sync_jobs
WHERE id NOT IN (
  SELECT MIN(id)
  FROM bulk_sync_jobs
  GROUP BY shop, start_date, end_date, object_type
);
"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📊 Final status:"
psql "postgresql://postgres.ihawjrtfwysyokfotewn:$KEY@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" -c "
SELECT
  object_type,
  status,
  COUNT(*) as count
FROM bulk_sync_jobs
GROUP BY object_type, status
ORDER BY object_type, status;
"
