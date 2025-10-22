import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// === CONFIG ==============================================================
const SHOPIFY_API_VERSION = "2025-01";
const BATCH_SIZE = 500;
const EDGE_FUNCTION_TIMEOUT_MS = 270000; // 4.5 min
const CHUNK_HOURS = 12;
const CURRENCY_RATES = { DKK: 1.0, EUR: 7.46, CHF: 6.84 };

// === SUPABASE SETUP ======================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// === TOKEN MAP ===========================================================
function getShopifyToken(shop: string) {
  const map: Record<string, string | null> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA"),
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE"),
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL"),
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT"),
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF"),
  };
  return map[shop] || null;
}

// === HELPERS =============================================================
function generateChunkedIntervals(start: string, end: string, hours: number) {
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T23:59:59Z");
  const chunks: { startISO: string; endISO: string }[] = [];
  const chunkMs = hours * 60 * 60 * 1000;
  let current = new Date(startDate);
  while (current < endDate) {
    const endChunk = new Date(Math.min(current.getTime() + chunkMs - 1, endDate.getTime()));
    chunks.push({ startISO: current.toISOString(), endISO: endChunk.toISOString() });
    current = new Date(endChunk.getTime() + 1);
  }
  return chunks;
}

async function safeFetch(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    console.warn(`⚠️ Rate limited — retrying in ${retryAfter}s (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return safeFetch(url, options, attempt + 1);
  }
  return res;
}

async function fetchOrdersWithRefunds(shop: string, token: string, startISO: string, endISO: string) {
  // Fetch orders updated in this time range (updated_at changes when refunds are created)
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?updated_at_min=${startISO}&updated_at_max=${endISO}&status=any&limit=250`;

  const res = await safeFetch(url, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    console.error(`❌ Failed to fetch orders: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = await res.json();
  const orders = json.orders || [];

  // Filter to only orders that actually have refunds
  const ordersWithRefunds = [];
  for (const order of orders) {
    if (order.refunds && order.refunds.length > 0) {
      // Check if any refund was created in our date range
      const refundsInRange = order.refunds.filter((refund: any) => {
        const refundCreated = new Date(refund.created_at);
        const start = new Date(startISO);
        const end = new Date(endISO);
        return refundCreated >= start && refundCreated <= end;
      });

      if (refundsInRange.length > 0) {
        ordersWithRefunds.push(order);
      }
    }
  }

  console.log(`  → ${ordersWithRefunds.length} orders have refunds created in date range`);
  return ordersWithRefunds;
}

// === MAIN FUNCTION =======================================================
serve(async (req) => {
  try {
    const { shop, startDate, endDate, jobId } = await req.json();

    if (!shop || !startDate || !endDate)
      return new Response(JSON.stringify({ error: "Missing shop/startDate/endDate" }), { status: 400 });

    const token = getShopifyToken(shop);
    if (!token)
      return new Response(JSON.stringify({ error: `No Shopify token for ${shop}` }), { status: 400 });

    console.log(`🚀 Starting refund sync for ${shop} (${startDate} → ${endDate})`);

    // === 🧹 Step 1: Auto-cleanup stale running jobs (older than 10 min) ===
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "failed",
        error_message: "Auto-cleanup: running > 10 min",
      })
      .eq("object_type", "refunds")
      .eq("status", "running")
      .lt("started_at", tenMinutesAgo);

    // === 🔍 Step 2: Check for other concurrent running refund jobs ===
    const { data: runningJobs, error: checkError } = await supabase
      .from("bulk_sync_jobs")
      .select("id, shop, start_date, status")
      .eq("shop", shop)
      .eq("object_type", "refunds")
      .eq("status", "running")
      .neq("id", jobId);

    if (checkError) console.warn("⚠️ Failed to check running jobs:", checkError.message);

    if (runningJobs && runningJobs.length > 0) {
      console.log(`⏸️ Skipping refund sync for ${shop} — another refund job already running`);
      return new Response(
        JSON.stringify({ error: "Another refund job already running", jobId: runningJobs[0].id }),
        { status: 409 }
      );
    }

    // === ✅ Step 3: Create or resume this job ===
    let job;
    if (jobId) {
      const { data, error: fetchError } = await supabase
        .from("bulk_sync_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();

      if (fetchError || !data) {
        console.warn(`⚠️ Job ${jobId} not found or deleted - creating new job`);
        // Job was deleted (e.g., by cleanup) - create new one instead
        const { data: newData, error: newError } = await supabase
          .from("bulk_sync_jobs")
          .insert({
            shop,
            start_date: startDate,
            end_date: endDate,
            object_type: "refunds",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (newError || !newData) {
          console.error("❌ Failed to create replacement job:", newError?.message);
          return new Response(JSON.stringify({ error: "Failed to create job", details: newError?.message }), { status: 500 });
        }
        job = newData;
      } else {
        job = data;
        await supabase.from("bulk_sync_jobs").update({ status: "running" }).eq("id", jobId);
      }
    } else {
      const { data, error: insertError } = await supabase
        .from("bulk_sync_jobs")
        .insert({
          shop,
          start_date: startDate,
          end_date: endDate,
          object_type: "refunds",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError || !data) {
        console.error("❌ Failed to create job:", insertError?.message);
        return new Response(JSON.stringify({ error: "Failed to create job", details: insertError?.message }), { status: 500 });
      }
      job = data;
    }

    const chunks = generateChunkedIntervals(startDate, endDate, CHUNK_HOURS);
    console.log(`📆 Processing ${chunks.length} chunks...`);
    const startTime = Date.now();
    let totalRefunds = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (Date.now() - startTime > EDGE_FUNCTION_TIMEOUT_MS) {
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "pending",
            error_message: `Timeout after ${i}/${chunks.length} chunks`,
          })
          .eq("id", job.id);
        return new Response(JSON.stringify({ success: false, timedOut: true }), { status: 500 });
      }

      const { startISO, endISO } = chunks[i];
      console.log(`💸 Chunk ${i + 1}/${chunks.length}: ${startISO} → ${endISO}`);
      const result = await syncRefundsForChunk(shop, token, supabase, startISO, endISO);
      totalRefunds += result.refundsProcessed || 0;

      await supabase.from("bulk_sync_jobs").update({ records_processed: totalRefunds }).eq("id", job.id);
    }

    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        records_processed: totalRefunds,
      })
      .eq("id", job.id);

    return new Response(JSON.stringify({ success: true, refundsProcessed: totalRefunds }), { status: 200 });
  } catch (err) {
    console.error("❌ Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// === REFUND SYNC PER CHUNK ===============================================
async function syncRefundsForChunk(shop, token, supabase, startISO, endISO) {
  // Fetch orders from Shopify API that were UPDATED in this date range
  // (updated_at changes when refunds are created)
  const ordersWithRefunds = await fetchOrdersWithRefunds(shop, token, startISO, endISO);
  console.log(`📦 Found ${ordersWithRefunds.length} orders with potential refunds`);

  if (ordersWithRefunds.length === 0) {
    console.warn(`⚠️ No orders with refunds found for ${shop} (${startISO} → ${endISO})`);
    return { refundsProcessed: 0, skusUpdated: 0 };
  }

  // Build tax_rate map from database
  const orderIds = ordersWithRefunds.map(o => o.id.toString().replace(/\D/g, ""));
  const { data: dbOrders } = await supabase
    .from("orders")
    .select("order_id, tax_rate")
    .eq("shop", shop)
    .in("order_id", orderIds);

  const taxRateMap = new Map();
  if (dbOrders) {
    for (const order of dbOrders) {
      if (order.tax_rate !== null && order.tax_rate !== undefined) {
        taxRateMap.set(String(order.order_id), order.tax_rate);
      }
    }
  }

  const uniqueOrderIds = orderIds;

  const refundUpdates = [];
  const orderUpdates = new Map(); // Track shipping refunds per order
  let processed = 0;

  for (const orderId of uniqueOrderIds) {
    processed++;
    const cleanOrderId = String(orderId).replace(/\D/g, ""); // Strip gid:// etc.
    const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${cleanOrderId}/refunds.json`;
    const res = await safeFetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      console.warn(`⚠️ Failed to fetch refunds for order ${cleanOrderId}: ${res.status} ${res.statusText}`);
      continue;
    }
    const json = await res.json();
    const refunds = json.refunds || [];
    if (refunds.length === 0) {
      console.log(`📭 No refunds for order ${cleanOrderId}`);
      continue;
    }

    for (const refund of refunds) {
      const refundDate = refund.created_at;
      const lineItems = refund.refund_line_items || [];
      const transactions = refund.transactions || [];
      const actualRefundAmount = transactions.reduce(
        (sum, t) => (t.kind === "refund" && t.status === "success" ? sum + parseFloat(t.amount || "0") : sum),
        0,
      );
      const isCancellation = actualRefundAmount === 0;
      const totalTheoretical = lineItems.reduce(
        (sum, li) =>
          sum +
          parseFloat(li.subtotal_set?.shop_money?.amount || "0") +
          parseFloat(li.total_tax_set?.shop_money?.amount || "0"),
        0,
      );

      // === 🚢 Parse shipping refunds from order_adjustments ===
      const orderAdjustments = refund.order_adjustments || [];
      for (const adj of orderAdjustments) {
        if (adj.kind === "shipping_refund") {
          // amount is negative for refunds (e.g. -31.20 DKK EX VAT)
          const shippingRefundDkk = Math.abs(parseFloat(adj.amount || "0"));
          const currency = adj.amount_set?.shop_money?.currency_code || "DKK";
          const rate = CURRENCY_RATES[currency] || 1;
          const shippingRefundDkkConverted = shippingRefundDkk * rate;

          // Accumulate shipping refunds per order with refund date
          if (!orderUpdates.has(cleanOrderId)) {
            orderUpdates.set(cleanOrderId, {
              shop,
              order_id: cleanOrderId,
              shipping_refund_dkk: 0,
              refund_date: refundDate
            });
          }
          const orderUpdate = orderUpdates.get(cleanOrderId);
          orderUpdate.shipping_refund_dkk += shippingRefundDkkConverted;

          // Keep the latest refund date
          if (new Date(refundDate) > new Date(orderUpdate.refund_date)) {
            orderUpdate.refund_date = refundDate;
          }

          console.log(`🚢 Order ${cleanOrderId}: Shipping refund ${shippingRefundDkkConverted.toFixed(2)} DKK on ${refundDate}`);
        }
      }

      for (const item of lineItems) {
        const sku = item.line_item?.sku;
        if (!sku) continue;
        const quantity = item.quantity || 0;
        let amountDkk = 0;

        // ✅ Get tax_rate from database (same as bulk-sync-skus)
        const taxRate = taxRateMap.get(cleanOrderId);

        if (isCancellation) {
          const subtotal = parseFloat(item.subtotal_set?.shop_money?.amount || "0");
          const currency = item.subtotal_set?.shop_money?.currency_code || "DKK";
          const rate = CURRENCY_RATES[currency] || 1;

          // ✅ FIXED (2025-10-22): Correct order of operations
          // 1. Convert currency to DKK first: 16.95 EUR × 7.46 = 126.447 DKK INCL VAT
          // 2. Remove VAT: 126.447 / (1 + 0.21) = 104.50 DKK EX VAT
          if (taxRate !== null && taxRate !== undefined) {
            const subtotalInclVatDkk = subtotal * rate;
            amountDkk = subtotalInclVatDkk / (1 + taxRate);
          } else {
            // Fallback: calculate from Shopify's tax data
            const tax = parseFloat(item.total_tax_set?.shop_money?.amount || "0");
            const calculatedTaxRate = tax > 0 && subtotal > 0 ? tax / (subtotal - tax) : 0;
            const subtotalInclVatDkk = subtotal * rate;
            amountDkk = subtotalInclVatDkk / (1 + calculatedTaxRate);
          }
        } else {
          const subtotal = parseFloat(item.subtotal_set?.shop_money?.amount || "0");
          const tax = parseFloat(item.total_tax_set?.shop_money?.amount || "0");
          const currency = item.subtotal_set?.shop_money?.currency_code || "DKK";
          const rate = CURRENCY_RATES[currency] || 1;

          // ✅ FIXED (2025-10-22): Convert actualRefundAmount to DKK FIRST
          // transactions[].amount is in SHOP currency (EUR for INT shop)
          // Need to get transaction currency from first transaction
          const firstTransaction = transactions.find(t => t.kind === "refund" && t.status === "success");
          const transactionCurrency = firstTransaction?.currency || currency;
          const transactionRate = CURRENCY_RATES[transactionCurrency] || 1;

          // 1. Convert actualRefundAmount from original currency to DKK INCL VAT
          const actualRefundAmountDkk = actualRefundAmount * transactionRate;

          // 2. Calculate proportion based on INCL VAT (subtotal + tax)
          const itemTotal = subtotal + tax;
          const proportion = totalTheoretical > 0 ? itemTotal / totalTheoretical : 0;

          // 3. Distribute proportionally in DKK INCL VAT
          const actualInclVatDkk = actualRefundAmountDkk * proportion;

          // 4. Remove VAT to get DKK EX VAT
          if (taxRate !== null && taxRate !== undefined) {
            amountDkk = actualInclVatDkk / (1 + taxRate);
          } else {
            // Fallback: calculate from Shopify's tax data
            const calculatedTaxRate = subtotal > 0 ? tax / subtotal : 0;
            amountDkk = actualInclVatDkk / (1 + calculatedTaxRate);
          }
        }

        const existing = refundUpdates.find((r) => r.shop === shop && r.order_id === cleanOrderId && r.sku === sku);
        if (existing) {
          if (isCancellation) {
            existing.cancelled_qty += quantity;
            existing.cancelled_amount_dkk += amountDkk;
          } else {
            existing.refunded_qty += quantity;
            existing.refunded_amount_dkk += amountDkk;
          }
          if (new Date(refundDate) > new Date(existing.refund_date)) {
            existing.refund_date = refundDate;
          }
        } else {
          refundUpdates.push({
            shop,
            order_id: orderId,
            sku,
            refunded_qty: isCancellation ? 0 : quantity,
            refunded_amount_dkk: isCancellation ? 0 : amountDkk,
            refund_date: refundDate,
            cancelled_qty: isCancellation ? quantity : 0,
            cancelled_amount_dkk: isCancellation ? amountDkk : 0,
          });
        }
      }
    }

    if (processed % 50 === 0) console.log(`⏳ Processed ${processed}/${uniqueOrderIds.length} orders`);
    await new Promise((r) => setTimeout(r, 500)); // Shopify rate limit
  }

  const updated = await updateRefundsInDatabase(supabase, refundUpdates);
  console.log(`✅ Chunk done: ${refundUpdates.length} refund lines, ${updated} SKUs updated`);

  // === 🚢 Update shipping refunds in orders table ===
  if (orderUpdates.size > 0) {
    const orderRefundArray = Array.from(orderUpdates.values());
    const ordersUpdated = await updateOrderShippingRefunds(supabase, orderRefundArray);
    console.log(`🚢 Updated ${ordersUpdated} orders with shipping refunds`);
  }

  // === 📦 Update fulfillments table with refund data ===
  const fulfillmentsUpdated = await updateFulfillmentsWithRefunds(supabase, refundUpdates);
  console.log(`📦 Updated ${fulfillmentsUpdated} fulfillments with refund data`);

  return { refundsProcessed: refundUpdates.length, skusUpdated: updated };
}

// === UPSERT / UPDATE =====================================================
async function updateRefundsInDatabase(supabase, refunds) {
  if (!refunds || refunds.length === 0) return 0;
  const MAX_RETRIES = 3;
  let totalUpdated = 0;

  for (let i = 0; i < refunds.length; i += BATCH_SIZE) {
    const batch = refunds.slice(i, i + BATCH_SIZE);
    const upsertData = batch.map((r) => ({
      shop: r.shop,
      order_id: r.order_id,
      sku: r.sku,
      refunded_qty: r.refunded_qty ?? 0,
      refunded_amount_dkk: r.refunded_amount_dkk ?? 0,
      refund_date: r.refund_date ?? null,
      cancelled_qty: r.cancelled_qty ?? 0,
      cancelled_amount_dkk: r.cancelled_amount_dkk ?? 0,
      created_at: new Date().toISOString()
    }));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { data, error } = await supabase
        .from("skus")
        .upsert(upsertData, { onConflict: "shop,order_id,sku" })
        .select();

      if (error) {
        console.error(`❌ Batch ${i / BATCH_SIZE + 1} failed (attempt ${attempt}): ${error.message}`);
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, attempt * 1000));
      } else {
        const affected = data?.length || 0;
        if (affected === 0)
          console.warn(`⚠️ No matching rows found in batch ${i / BATCH_SIZE + 1}`);
        totalUpdated += affected;
        console.log(`✅ Batch ${i / BATCH_SIZE + 1} updated ${affected} rows`);
        break;
      }
    }
  }

  console.log(`🎉 Refund update complete: ${totalUpdated} SKUs updated`);
  return totalUpdated;
}

// === UPDATE SHIPPING REFUNDS IN ORDERS TABLE ================================
async function updateOrderShippingRefunds(supabase, orderRefunds) {
  if (!orderRefunds || orderRefunds.length === 0) return 0;
  let totalUpdated = 0;

  for (const orderRefund of orderRefunds) {
    // Fetch existing order to preserve shipping_discount_dkk
    const { data: existing, error: fetchError } = await supabase
      .from("orders")
      .select("shipping_discount_dkk")
      .eq("shop", orderRefund.shop)
      .eq("order_id", orderRefund.order_id)
      .single();

    if (fetchError) {
      console.error(`❌ Failed to fetch order ${orderRefund.order_id}: ${fetchError.message}`);
      continue;
    }

    // Update only shipping_refund_dkk and refund_date, preserve shipping_discount_dkk
    const { error } = await supabase
      .from("orders")
      .update({
        shipping_refund_dkk: orderRefund.shipping_refund_dkk,
        refund_date: orderRefund.refund_date,
        shipping_discount_dkk: existing?.shipping_discount_dkk // Preserve existing value
      })
      .eq("shop", orderRefund.shop)
      .eq("order_id", orderRefund.order_id);

    if (error) {
      console.error(`❌ Failed to update shipping refund for order ${orderRefund.order_id}: ${error.message}`);
    } else {
      totalUpdated++;
    }
  }

  return totalUpdated;
}

// === UPDATE FULFILLMENTS TABLE WITH REFUND DATA ================================
async function updateFulfillmentsWithRefunds(supabase, refunds) {
  if (!refunds || refunds.length === 0) return 0;

  // Group refunds by order_id
  const refundsByOrder = new Map();

  for (const refund of refunds) {
    if (!refundsByOrder.has(refund.order_id)) {
      refundsByOrder.set(refund.order_id, {
        shop: refund.shop,
        order_id: refund.order_id,
        refunded_qty: 0,
        refund_date: null
      });
    }

    const current = refundsByOrder.get(refund.order_id);
    current.refunded_qty += refund.refunded_qty || 0;

    // Keep latest refund_date - but ONLY from actual refunds, not cancellations
    // This prevents cancelled items' refund_date from overriding actual refund dates
    if (refund.refund_date && refund.refunded_qty > 0) {
      if (!current.refund_date || new Date(refund.refund_date) > new Date(current.refund_date)) {
        current.refund_date = refund.refund_date;
      }
    }
  }

  let totalUpdated = 0;

  // Update fulfillments for each order
  // ⚠️ CRITICAL: Only update ONE fulfillment row per order to prevent duplication
  // Some orders have duplicate fulfillment rows from different sync methods (bulk-sync-fulfillments vs sync-fulfillments-for-date.sh)
  // Strategy: Update the OLDEST row (earliest created_at) to preserve historical data
  for (const [orderId, data] of refundsByOrder) {
    // First, get the oldest fulfillment row for this order
    const { data: oldestFulfillment, error: selectError } = await supabase
      .from("fulfillments")
      .select("id, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (selectError || !oldestFulfillment) {
      console.error(`❌ Failed to find fulfillment for order ${orderId}: ${selectError?.message}`);
      continue;
    }

    // Now update ONLY that specific row by id
    const { error: updateError } = await supabase
      .from("fulfillments")
      .update({
        refunded_qty: data.refunded_qty,
        refund_date: data.refund_date
      })
      .eq("id", oldestFulfillment.id);

    if (updateError) {
      console.error(`❌ Failed to update fulfillment ${oldestFulfillment.id} for order ${orderId}: ${updateError.message}`);
    } else {
      totalUpdated++;
    }
  }

  return totalUpdated;
}