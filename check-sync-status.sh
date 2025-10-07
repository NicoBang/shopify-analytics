#!/bin/bash

# Check sync status for a date range
# Usage: ./check-sync-status.sh 2025-09-01 2025-09-30

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

START_DATE=${1:-"2025-09-01"}
END_DATE=${2:-"2025-10-07"}

echo "🔍 Checking sync status from $START_DATE to $END_DATE"
echo ""

# Fetch all jobs in date range, ordered by created_at to get latest first
curl -s -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  "https://ihawjrtfwysyokfotewn.supabase.co/rest/v1/bulk_sync_jobs?start_date=gte.${START_DATE}&end_date=lte.${END_DATE}&select=shop,object_type,start_date,status,created_at&order=created_at.desc" \
  > /tmp/jobs.json

python3 << EOF
import json
from datetime import datetime, timedelta

# Load jobs
with open('/tmp/jobs.json') as f:
    jobs = json.load(f)

# Debug: Show total jobs fetched and any running jobs
print(f"🔎 DEBUG: Fetched {len(jobs)} total jobs")
running_jobs_raw = [j for j in jobs if j.get('status') == 'running']
if running_jobs_raw:
    print(f"🔎 DEBUG: Found {len(running_jobs_raw)} jobs with status='running':")
    for j in running_jobs_raw:
        print(f"   - {j.get('shop','?')[:15]:15} {j.get('object_type','?'):6} {j.get('start_date','?')} {j.get('status','?')}")
print()

# Define expected shops and types
shops = [
    "pompdelux-da.myshopify.com",
    "pompdelux-de.myshopify.com",
    "pompdelux-nl.myshopify.com",
    "pompdelux-int.myshopify.com",
    "pompdelux-chf.myshopify.com"
]
types = ["orders", "skus"]

# Get date range
start_date = datetime.strptime("${START_DATE}", "%Y-%m-%d")
end_date = datetime.strptime("${END_DATE}", "%Y-%m-%d")

# Generate all expected combinations
expected = set()
current_date = start_date
while current_date <= end_date:
    date_str = current_date.strftime("%Y-%m-%d")
    for shop in shops:
        for obj_type in types:
            expected.add((shop, obj_type, date_str))
    current_date += timedelta(days=1)

# Build sets - only count the LATEST status for each shop/type/date
# Jobs are already sorted by created_at desc, so first occurrence is newest
latest_jobs = {}

for job in jobs:
    shop = job["shop"]
    obj_type = job["object_type"]
    date = job["start_date"]
    status = job["status"]

    # Handle "both" type - expand to orders and skus
    if obj_type == "both":
        keys = [(shop, "orders", date), (shop, "skus", date)]
    else:
        keys = [(shop, obj_type, date)]

    # Store only the first (newest) status for each key
    for key in keys:
        if key not in latest_jobs:
            latest_jobs[key] = status

# Build final sets from latest statuses
completed = set()
failed = set()
running = set()

for key, status in latest_jobs.items():
    if status == "completed":
        completed.add(key)
    elif status == "failed":
        failed.add(key)
    elif status == "running":
        running.add(key)

# Find missing
missing = expected - completed

# Print summary
total = len(expected)
completed_count = len(completed)
failed_count = len(failed)
running_count = len(running)
missing_count = len(missing)

print(f"📊 Summary:")
print(f"   Total expected: {total}")
print(f"   ✅ Completed:   {completed_count} ({completed_count*100//total if total > 0 else 0}%)")
print(f"   ❌ Failed:      {failed_count}")
print(f"   🔄 Running:     {running_count}")
print(f"   ⚠️  Missing:     {missing_count}")
print()

# Show failed jobs
if failed:
    print("❌ Failed jobs:")
    for shop, obj_type, date in sorted(failed):
        shop_short = shop.split(".")[0].replace("pompdelux-", "")
        print(f"   {shop_short:5} {date} {obj_type:6} = FAILED")
    print()

# Show running jobs
if running:
    print("🔄 Running jobs:")
    for shop, obj_type, date in sorted(running):
        shop_short = shop.split(".")[0].replace("pompdelux-", "")
        print(f"   {shop_short:5} {date} {obj_type:6} = RUNNING")
    print()

# Show missing jobs (limit to 50)
if missing:
    print("⚠️  Missing jobs:")
    for shop, obj_type, date in sorted(missing)[:50]:
        shop_short = shop.split(".")[0].replace("pompdelux-", "")
        print(f"   {shop_short:5} {date} {obj_type:6} = MISSING")
    if len(missing) > 50:
        print(f"   ... and {len(missing) - 50} more")
EOF

rm /tmp/jobs.json
