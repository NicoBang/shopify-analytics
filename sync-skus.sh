#!/bin/bash

SHOPS=("pompdelux-da.myshopify.com"
       "pompdelux-de.myshopify.com"
       "pompdelux-nl.myshopify.com"
       "pompdelux-int.myshopify.com"
       "pompdelux-chf.myshopify.com")

# Synkroniser måned for måned fra sept 2024 til nu
MONTHS=(
  "2024-09-01:2024-09-30"
  "2024-10-01:2024-10-31"
  "2024-11-01:2024-11-30"
  "2024-12-01:2024-12-31"
  "2025-01-01:2025-01-31"
  "2025-02-01:2025-02-28"
  "2025-03-01:2025-03-31"
  "2025-04-01:2025-04-30"
  "2025-05-01:2025-05-31"
  "2025-06-01:2025-06-30"
  "2025-07-01:2025-07-31"
  "2025-08-01:2025-08-31"
  "2025-09-01:2025-09-30"
  "2025-10-01:2025-10-02"
)

for month in "${MONTHS[@]}"; do
  IFS=':' read -r startDate endDate <<< "$month"
  echo "📅 Synkroniserer periode: $startDate til $endDate"
  
  for shop in "${SHOPS[@]}"; do
    echo "  🏪 $shop..."
    curl -s -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
      "https://shopify-analytics-g6e27cudf-nicolais-projects-291e9559.vercel.app/api/sync-shop?shop=$shop&type=skus&startDate=$startDate&endDate=$endDate" \
      > /dev/null &
  done
  
  wait
  echo "✅ Periode $startDate til $endDate færdig\n"
  sleep 2  # Lille pause mellem måneder
done

echo "🎉 ALLE historiske data synkroniseret!"