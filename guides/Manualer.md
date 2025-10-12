Tjek, om der mangler ordrer i SKUS eller ORDERS

## Kør command:

```bash
curl -X POST "https://ihawjrtfwysyokfotewn.supabase.co/functions/v1/sync-order-sequences" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"shop": "pompdelux-chf.myshopify.com"}'

```

Dette opretter alle order_id's som ikke findes i enten skus, orders eller begge.

I **order_sequence_validation** findes alle ordrer.

I **order_sequence_missing_data** oprettes manglerne

I **order_sequence_gaps** registreres det, om der er gaps i ordrerækken

I **skus_order_index** findes alle unikke order_id's fra skus. De oprettes automatisk.

