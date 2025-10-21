#!/bin/bash

# Cleanup duplicate fulfillments in database

API_KEY='@Za#SJxn;gnBxJ;Iu2uixoUd&#'"'"'ndl'

echo "🧹 Starting fulfillments cleanup..."

curl -s -X GET 'https://shopify-analytics-nu.vercel.app/api/fulfillments?type=cleanup' \
  -H "Authorization: Bearer $API_KEY" | jq .

echo ""
echo "✅ Cleanup complete"
