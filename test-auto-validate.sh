#!/bin/bash

# Test Auto-Validate Failed Jobs
# Purpose: Manually trigger auto-validation for testing

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM"

echo "🤖 Testing auto-validate system..."
echo ""

curl -s -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/auto-validate-failed-jobs" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    if r.get('success'):
        summary = r.get('summary', {})
        details = r.get('details', {})
        print('✅ Auto-validate completed successfully!')
        print('')
        print('📊 Summary:')
        print(f'  Empty days corrected: {summary.get(\"totalUpdated\", 0)}')
        print(f'  Real failures remaining: {summary.get(\"totalRealFailures\", 0)}')
        print('')
        print('📦 Details:')
        print(f'  Orders: {details.get(\"orders\", {}).get(\"updated\", 0)} updated, {details.get(\"orders\", {}).get(\"realFailures\", 0)} real failures')
        print(f'  SKUs: {details.get(\"skus\", {}).get(\"updated\", 0)} updated, {details.get(\"skus\", {}).get(\"realFailures\", 0)} real failures')
        print(f'  Refunds: {details.get(\"refunds\", {}).get(\"updated\", 0)} updated, {details.get(\"refunds\", {}).get(\"realFailures\", 0)} real failures')
        print(f'  Shipping Discounts: {details.get(\"shippingDiscounts\", {}).get(\"updated\", 0)} updated, {details.get(\"shippingDiscounts\", {}).get(\"realFailures\", 0)} real failures')
    else:
        print('❌ Error:', r.get('error', 'Unknown error'))
except:
    print('❌ Failed to parse response')
"

echo ""
