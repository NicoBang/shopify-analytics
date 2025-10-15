EKSEMPLER:

UPDATED ORDERS ALL SHOPS / CREATED ALL SHOPS

```jsx
SHOPS=("pompdelux-da.myshopify.com"                                     
       "pompdelux-de.myshopify.com"                               
       "pompdelux-nl.myshopify.com"                               
       "pompdelux-int.myshopify.com"                                
       "pompdelux-chf.myshopify.com")                                  

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=orders&startDate=2025-09-01&endDate=2025-09-30&updatedMode=true" &
done

wait
echo "✅ Alle shops synkroniseret med updated_at mode"
```

```jsx
SHOPS=("pompdelux-da.myshopify.com"                                     
       "pompdelux-de.myshopify.com"                               
       "pompdelux-nl.myshopify.com"                               
       "pompdelux-int.myshopify.com"                                
       "pompdelux-chf.myshopify.com")                                

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=orders&startDate=2025-09-01&endDate=2025-09-30" &
done

wait
echo "✅ Alle shops synkroniseret med created_at mode"
```

UPDATED SKUS ALL SHOPS / CREATED ALL SHOPS

```jsx
SHOPS=("pompdelux-da.myshopify.com"                                     
       "pompdelux-de.myshopify.com"                               
       "pompdelux-nl.myshopify.com"                               
       "pompdelux-int.myshopify.com"                                
       "pompdelux-chf.myshopify.com")                                 

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=skus&startDate=2025-09-15&endDate=2025-09-30&updatedMode=true" &
done

wait
echo "✅ Alle shops synkroniseret med updated_at mode"
```

```jsx
SHOPS=("pompdelux-da.myshopify.com"                                     
       "pompdelux-de.myshopify.com"                               
       "pompdelux-nl.myshopify.com"                               
       "pompdelux-int.myshopify.com"                                
       "pompdelux-chf.myshopify.com")                                  

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=skus&startDate=2025-09-15&endDate=2025-09-30" &
done

wait
echo "✅ Alle shops synkroniseret med created_at mode"
```

Fulfillments

```jsx
SHOPS=("pompdelux-da.myshopify.com"                                     
       "pompdelux-de.myshopify.com"                               
       "pompdelux-nl.myshopify.com"                               
       "pompdelux-int.myshopify.com"                                
       "pompdelux-chf.myshopify.com")                                

for shop in "${SHOPS[@]}"; do
  curl -H "Authorization: Bearer bda5da3d49fe0e7391fded3895b5c6bc" \
  "https://shopify-analytics-nu.vercel.app/api/sync-shop?shop=$shop&type=fulfillments&startDate=2025-08-01&endDate=2025-08-31" &
done

wait
echo "✅ Alle shops synkroniseret med fulfillments"
```