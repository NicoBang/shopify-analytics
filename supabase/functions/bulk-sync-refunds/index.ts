import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPIFY_API_VERSION = "2024-10";
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_ATTEMPTS = 720; // 2 hours max (720 * 10s)
const BATCH_SIZE = 500;
const EDGE_FUNCTION_TIMEOUT_MS = 270000; // 4.5 minutes (Edge Functions have ~5 min hard limit)
const CHUNK_HOURS = 12; // Process 12-hour chunks to avoid timeouts

const CURRENCY_RATES: Record<string, number> = {
  DKK: 1.0,
  EUR: 7.46,
  CHF: 6.84,
};

interface BulkSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  jobId?: string; // Optional jobId for orchestrator integration
}

interface RefundUpdate {
  shop: string;
  order_id: string;
  sku: string;
  refunded_qty: number;
  refund_date: string | null;
  refunded_amount_dkk: number;
  cancelled_qty?: number;
  cancelled_amount_dkk?: number;
}

serve(async (req: Request): Promise<Response> => {
  try {
    console.log("🚀 bulk-sync-refunds function invoked");

    const body = await req.json().catch(() => null);
    if (!body) {
      console.error("❌ Invalid or missing JSON body");
      return new Response(
        JSON.stringify({ error: "Invalid or missing JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { shop, startDate, endDate, jobId }: BulkSyncRequest = body;
    console.log(`📋 Request params: shop=${shop}, startDate=${startDate}, endDate=${endDate}, jobId=${jobId || 'none'}`);

    if (!shop || !startDate || !endDate) {
      console.error("❌ Missing required fields");
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, startDate, endDate",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("🔗 Creating Supabase client");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    console.log(`🔑 [DEBUG] Using Supabase URL: ${supabaseUrl}`);
    console.log(`🔑 [DEBUG] Service Role Key starts with: ${supabaseKey.substring(0, 20)}...`);
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });

    console.log("🔑 Getting Shopify token");
    const token = getShopifyToken(shop);
    if (!token) {
      const error = `No Shopify token found for shop ${shop}`;
      console.error(`❌ ${error}`);
      throw new Error(error);
    }

    // Create or update job record
    let job: any;
    if (jobId) {
      console.log(`📋 Using existing job ${jobId}`);
      const { data, error } = await supabase
        .from("bulk_sync_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (error || !data) {
        throw new Error(`Job ${jobId} not found: ${error?.message}`);
      }
      job = data;

      // Update to running status
      await supabase
        .from("bulk_sync_jobs")
        .update({
          status: "running",
          started_at: new Date().toISOString()
        })
        .eq("id", jobId);
    } else {
      console.log(`📋 Creating new job for ${shop} (${startDate} to ${endDate})`);
      const { data, error: jobError } = await supabase
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

      if (jobError || !data) {
        throw new Error(`Failed to create job: ${jobError?.message}`);
      }
      job = data;
      console.log(`📋 Created job ${job.id}`);
    }

    console.log(`🚀 Starting refund sync for ${shop} from ${startDate} to ${endDate}`);
    console.log(`🔍 [DEBUG] Input parameters: shop=${shop}, startDate=${startDate}, endDate=${endDate}`);
    const chunks = generateChunkedIntervals(startDate, endDate, CHUNK_HOURS);
    console.log(`📅 Processing ${chunks.length} chunks (${CHUNK_HOURS}h each)`);
    console.log(`📅 [DEBUG] Chunked intervals:`, JSON.stringify(chunks, null, 2));

    const results: any[] = [];
    const startTime = Date.now();
    let timedOut = false;
    let totalRefunds = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // ⏰ Check if approaching Edge Function timeout
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > EDGE_FUNCTION_TIMEOUT_MS) {
        console.log(`⚠️ Approaching Edge Function timeout (${elapsedMs}ms elapsed). Stopping gracefully.`);
        timedOut = true;

        // Update job with partial progress
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "pending", // Set back to pending so orchestrator can restart
            error_message: `Edge Function timeout after processing ${i}/${chunks.length} chunks`,
            records_processed: totalRefunds,
          })
          .eq("id", job.id);

        return new Response(
          JSON.stringify({
            success: false,
            timedOut: true,
            jobId: job.id,
            error: "Edge Function timeout",
            chunksProcessed: i,
            totalChunks: chunks.length,
            refundsProcessed: totalRefunds,
            message: `Processed ${i}/${chunks.length} chunks before timeout. Orchestrator will restart.`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`💸 Syncing refunds for chunk ${i + 1}/${chunks.length} (${chunk.startISO} to ${chunk.endISO})`);
      const res = await syncRefundsForChunk(shop, token, supabase, chunk.startISO, chunk.endISO);
      results.push(res);
      totalRefunds += res.refundsProcessed || 0;

      // Update job progress
      await supabase
        .from("bulk_sync_jobs")
        .update({
          records_processed: totalRefunds,
        })
        .eq("id", job.id);
    }

    // Mark job as completed
    await supabase
      .from("bulk_sync_jobs")
      .update({
        status: "completed",
        records_processed: totalRefunds,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    const response = {
      success: true,
      timedOut: false,
      jobId: job.id,
      status: "completed",
      chunksProcessed: chunks.length,
      totalChunks: chunks.length,
      refundsProcessed: totalRefunds,
      results
    };
    console.log(`🎉 Final response:`, JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Uncaught error:", err);
    console.error("Stack trace:", err.stack);

    // Try to update job status to failed
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      });

      const { shop, startDate, endDate, jobId }: BulkSyncRequest = body;
      if (jobId) {
        await supabase
          .from("bulk_sync_jobs")
          .update({
            status: "failed",
            error_message: err.message || String(err),
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    } catch (updateErr) {
      console.error("❌ Failed to update job status:", updateErr);
    }

    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function getShopifyToken(shop: string): string | null {
  const map: Record<string, string> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA") || "",
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE") || "",
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL") || "",
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT") || "",
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF") || "",
  };
  return map[shop] || null;
}

function generateChunkedIntervals(start: string, end: string, chunkHours: number) {
  console.log(`🔧 [DEBUG] generateChunkedIntervals input: start=${start}, end=${end}, chunkHours=${chunkHours}`);

  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T23:59:59Z');
  const chunks: Array<{ startISO: string; endISO: string }> = [];

  console.log(`🔧 [DEBUG] Parsed dates: startDate=${startDate.toISOString()}, endDate=${endDate.toISOString()}`);

  const chunkMs = chunkHours * 60 * 60 * 1000; // Convert hours to milliseconds
  let currentStart = new Date(startDate);

  while (currentStart < endDate) {
    const currentEnd = new Date(Math.min(
      currentStart.getTime() + chunkMs - 1, // -1ms to avoid overlap
      endDate.getTime()
    ));

    const startISO = currentStart.toISOString();
    const endISO = currentEnd.toISOString();
    chunks.push({ startISO, endISO });
    console.log(`📅 [DEBUG] Generated chunk: ${startISO} to ${endISO}`);

    currentStart = new Date(currentEnd.getTime() + 1); // Move to next millisecond
  }

  console.log(`🔧 [DEBUG] Generated ${chunks.length} chunks of ${chunkHours}h each`);
  return chunks;
}

async function syncRefundsForChunk(
  shop: string,
  token: string,
  supabase: any,
  startISO: string,
  endISO: string
) {
  try {
    console.log(`💸 Fetching orders with refunds from ${startISO} to ${endISO} from database`);

    // Get order_ids from database for the specific date range
    // This ensures we only check orders that were created in the target period
    console.log(`🔍 [DEBUG] Querying Supabase for orders from ${startISO} to ${endISO}`);
    console.log(`🔍 [DEBUG] Query filters: shop=${shop}, created_at >= ${startISO}, created_at <= ${endISO}`);

    const { data: orders, error: ordersError } = await supabase
      .from("skus")
      .select("order_id, created_at")
      .eq("shop", shop)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .limit(1000); // Process in batches to avoid timeouts

    if (ordersError) {
      console.error(`❌ Database error:`, ordersError);
      throw new Error(`Database error: ${ordersError.message}`);
    }

    console.log(`📦 Supabase returned ${orders?.length || 0} order records`);

    if (orders && orders.length > 0) {
      console.log(`🔍 [DEBUG] First 3 order records:`, JSON.stringify(orders.slice(0, 3), null, 2));
    }

    const uniqueOrderIds = [...new Set(orders.map((o: any) => String(o.order_id)))];
    console.log(`📦 Found ${uniqueOrderIds.length} unique orders to check for refunds`);

    if (uniqueOrderIds.length > 0) {
      console.log(`🔍 [DEBUG] First 5 order IDs:`, uniqueOrderIds.slice(0, 5));
    }

    if (uniqueOrderIds.length === 0) {
      console.log(`⚠️ No orders found in database for shop ${shop}`);
      return {
        status: "success",
        ordersFetched: 0,
        refundsProcessed: 0,
        skusUpdated: 0,
      };
    }

  const refundUpdates: RefundUpdate[] = [];
  let processedOrders = 0;

  // Fetch refunds for each order via REST API
  for (const orderId of uniqueOrderIds) {
    const orderIdStr = String(orderId);
    processedOrders++;

    // Log detailed response for first 2 orders
    const shouldLogDetail = processedOrders <= 2;

    if (processedOrders % 50 === 0) {
      console.log(`⏳ Progress: ${processedOrders}/${uniqueOrderIds.length} orders processed`);
    }

    try {
      if (shouldLogDetail) {
        console.log(`🔗 [DETAILED] Fetching refunds for order ${orderIdStr}`);
      }

      // Shopify REST API: GET /admin/api/2024-10/orders/{order_id}/refunds.json
      // Request all fields - remove fields parameter to get full response
      const refundsUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderIdStr}/refunds.json`;

      if (shouldLogDetail) {
        console.log(`🌐 [DETAILED] Endpoint: ${refundsUrl}`);
      }

      const refundsRes = await fetch(refundsUrl, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      });

      if (!refundsRes.ok) {
        console.warn(`⚠️ Failed to fetch refunds for order ${orderIdStr}: ${refundsRes.status}`);
        continue;
      }

      const text = await refundsRes.text();

      if (shouldLogDetail) {
        console.log(`📨 [DETAILED] Shopify raw response for order ${orderIdStr}:`, text);
      }

      let refundsData;
      try {
        refundsData = JSON.parse(text);
      } catch (parseErr) {
        console.error(`❌ Failed to parse JSON for order ${orderIdStr}:`, parseErr);
        refundsData = null;
      }

      if (shouldLogDetail) {
        console.log(`🧾 [DETAILED] Refund data for order ${orderIdStr}:`, JSON.stringify(refundsData, null, 2));
      }

      const refunds = refundsData?.refunds || [];

      if (shouldLogDetail) {
        console.log(`📊 [DETAILED] Found ${refunds.length} refunds for order ${orderIdStr}`);
        if (refunds.length > 0) {
          console.log(`🔍 [DETAILED] First refund structure:`, JSON.stringify(refunds[0], null, 2));
          console.log(`🔍 [DETAILED] First refund keys:`, Object.keys(refunds[0]));
          console.log(`🔍 [DETAILED] First refund has refund_line_items?`, !!refunds[0].refund_line_items);
          if (refunds[0].refund_line_items) {
            console.log(`📦 [DETAILED] refund_line_items count:`, refunds[0].refund_line_items.length);
            if (refunds[0].refund_line_items.length > 0) {
              const firstItem = refunds[0].refund_line_items[0];
              console.log(`📦 [DETAILED] First refund_line_item structure:`, JSON.stringify(firstItem, null, 2));
              console.log(`💰 [DEBUG] First item subtotal_set:`, JSON.stringify(firstItem.subtotal_set, null, 2));
              console.log(`💰 [DEBUG] First item total_tax_set:`, JSON.stringify(firstItem.total_tax_set, null, 2));
            }
          }
        }
      }

      if (refunds.length === 0) continue;

      // Parse refund_line_items from each refund
      for (const refund of refunds) {
        const refundDate = refund.created_at;

        // Process ALL refunds for orders in the target date range
        // (refunds can be created after the order date, so we don't filter by refund date)

        const refundLineItems = refund.refund_line_items || [];
        const transactions = refund.transactions || [];

        // Get actual refunded amount from transactions (this is what was actually paid back)
        const actualRefundAmount = transactions.reduce((sum, t) => {
          if (t.kind === 'refund' && t.status === 'success') {
            return sum + parseFloat(t.amount || "0");
          }
          return sum;
        }, 0);

        // Determine if this is a cancellation (no money refunded) or a real refund (money returned)
        const isCancellation = actualRefundAmount === 0;

        if (shouldLogDetail && processedOrders <= 2) {
          console.log(`📦 [DETAILED] Found ${refundLineItems.length} refund_line_items for refund ${refund.id}`);
          if (refundLineItems.length > 0 && isCancellation) {
            console.log(`📦 [CANCELLATION DEBUG] First refund_line_item:`, JSON.stringify(refundLineItems[0], null, 2));
          }
        }

        // Calculate total theoretical refund from line items (for proportional distribution)
        const theoreticalTotal = refundLineItems.reduce((sum, item) => {
          const subtotal = parseFloat(item.subtotal_set?.shop_money?.amount || String(item.subtotal || "0"));
          const tax = parseFloat(item.total_tax_set?.shop_money?.amount || String(item.total_tax || "0"));
          return sum + subtotal + tax;
        }, 0);

        if (shouldLogDetail && processedOrders <= 2) {
          console.log(`💰 [REFUND] Actual refund amount from transactions: ${actualRefundAmount.toFixed(2)} DKK`);
          console.log(`💰 [REFUND] Theoretical total from line items: ${theoreticalTotal.toFixed(2)} DKK`);
        }

        for (const item of refundLineItems) {
          const lineItem = item.line_item || {};
          const sku = lineItem.sku;
          const quantity = item.quantity;

          // Calculate amount differently for cancellations vs refunds
          let amountDkk: number;

          if (isCancellation) {
            // For cancellations, use subtotal and total_tax from refund line item
            const subtotalStr = item.subtotal_set?.shop_money?.amount || String(item.subtotal || "0");
            const taxStr = item.total_tax_set?.shop_money?.amount || String(item.total_tax || "0");
            const subtotalInclVat = parseFloat(subtotalStr);
            const taxAmount = parseFloat(taxStr);

            // Calculate ex VAT by subtracting tax from subtotal
            const cancelledPriceExVat = subtotalInclVat - taxAmount;

            console.log(`🔍 [CANCELLATION] SKU ${sku}: subtotal=${subtotalInclVat} (incl. tax), tax=${taxAmount}, exVat=${cancelledPriceExVat}`);

            // Get currency and convert to DKK
            const currency = item.subtotal_set?.shop_money?.currency_code ||
                            lineItem.price_set?.shop_money?.currency_code ||
                            "DKK";
            const currencyRate = CURRENCY_RATES[currency] || 1;

            // Convert to DKK (already ex VAT)
            amountDkk = cancelledPriceExVat * currencyRate;

            console.log(`🔍 [CANCELLATION] SKU ${sku}: currency=${currency}, rate=${currencyRate}, amountDkk=${amountDkk.toFixed(2)}`);
          } else {
            // For refunds, use the proportional distribution from transactions
            // Calculate this line item's theoretical amount (incl VAT)
            const subtotalStr = item.subtotal_set?.shop_money?.amount || String(item.subtotal || "0");
            const taxStr = item.total_tax_set?.shop_money?.amount || String(item.total_tax || "0");
            const subtotal = parseFloat(subtotalStr);
            const tax = parseFloat(taxStr);
            const theoreticalLineAmountInclVat = subtotal + tax;

            // Calculate actual refunded amount for this line item (incl VAT)
            // If multiple line items, distribute proportionally
            // If single line item, use the full transaction amount
            let actualLineAmountInclVat: number;
            if (refundLineItems.length === 1) {
              actualLineAmountInclVat = actualRefundAmount;
            } else if (theoreticalTotal > 0) {
              const proportion = theoreticalLineAmountInclVat / theoreticalTotal;
              actualLineAmountInclVat = actualRefundAmount * proportion;
            } else {
              actualLineAmountInclVat = 0;
            }

            // Calculate ex VAT for this line item
            // Use the tax amount from the line item to determine ex VAT proportionally
            const theoreticalExVat = subtotal - tax;  // Ex VAT for theoretical amount
            const theoreticalTaxRate = theoreticalExVat > 0 ? tax / theoreticalExVat : 0;

            // Apply same tax rate to actual refund amount to get ex VAT
            const actualLineAmountExVat = actualLineAmountInclVat / (1 + theoreticalTaxRate);

            // Get currency and convert to DKK
            const currency = item.subtotal_set?.shop_money?.currency_code ||
                            lineItem.price_set?.shop_money?.currency_code ||
                            "DKK";
            const rate = CURRENCY_RATES[currency] || 1;
            amountDkk = actualLineAmountExVat * rate;
          }

          if (shouldLogDetail && processedOrders <= 2) {
            if (isCancellation) {
              console.log(`🔍 [CALC] SKU ${sku}: CANCELLATION, amount in DKK=${amountDkk.toFixed(2)}`);
            } else {
              console.log(`🔍 [CALC] SKU ${sku}: REFUND, amount in DKK=${amountDkk.toFixed(2)}`);
            }
          }

          if (!sku) {
            console.warn(`⚠️ Refund line item missing SKU in order ${orderIdStr}`);
            continue;
          }

          // Critical debug point - verify amountDkk before aggregation
          if (isCancellation) {
            console.log(`🚨 [DEBUG] BEFORE AGGREGATION - SKU ${sku}: isCancellation=${isCancellation}, quantity=${quantity}, amountDkk=${amountDkk}`);
          }

          const key = `${shop}-${orderIdStr}-${sku}`;
          const existing = refundUpdates.find(
            (r) => r.shop === shop && r.order_id === orderIdStr && r.sku === sku
          );

          if (existing) {
            if (isCancellation) {
              console.log(`📝 [AGGREGATE] Adding to existing cancellation for ${sku}: qty+=${quantity}, amount+=${amountDkk.toFixed(2)}`);
              existing.cancelled_qty = (existing.cancelled_qty || 0) + quantity;
              existing.cancelled_amount_dkk = (existing.cancelled_amount_dkk || 0) + amountDkk;
            } else {
              console.log(`📝 [AGGREGATE] Adding to existing refund for ${sku}: qty+=${quantity}, amount+=${amountDkk.toFixed(2)}`);
              existing.refunded_qty += quantity;
              existing.refunded_amount_dkk += amountDkk; // Fixed: use refunded_amount_dkk
              if (new Date(refundDate) > new Date(existing.refund_date)) {
                existing.refund_date = refundDate;
              }
            }
          } else {
            if (isCancellation) {
              console.log(`📝 [NEW] Creating new cancellation entry for ${sku}: qty=${quantity}, amount=${amountDkk.toFixed(2)} DKK`);
              refundUpdates.push({
                shop,
                order_id: orderIdStr,
                sku,
                refunded_qty: 0,
                refund_date: null as any, // null for cancellations (no refund date)
                refunded_amount_dkk: 0,
                cancelled_qty: quantity,
                cancelled_amount_dkk: amountDkk,
              });
            } else {
              console.log(`📝 [NEW] Creating new refund entry for ${sku}: qty=${quantity}, amount=${amountDkk.toFixed(2)} DKK`);
              refundUpdates.push({
                shop,
                order_id: orderIdStr,
                sku,
                refunded_qty: quantity,
                refund_date: refundDate,
                refunded_amount_dkk: amountDkk, // Fixed: use refunded_amount_dkk
                cancelled_qty: 0,
                cancelled_amount_dkk: 0,
              });
            }
          }
        }
      }

      // Rate limiting: 2 requests/second for Shopify API
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err: any) {
      console.error(`❌ Error fetching refunds for order ${orderIdStr}:`, err.message);
    }
  }

  console.log(`💸 Found ${refundUpdates.length} refund line items`);
  console.log(`📊 Processing ${processedOrders} orders total`);

  // Update database
  const updatedCount = await updateRefundsInDatabase(supabase, refundUpdates);

  const result = {
    status: "success",
    ordersFetched: processedOrders,
    refundsProcessed: refundUpdates.length,
    skusUpdated: updatedCount,
  };

  console.log(`✅ Chunk complete:`, JSON.stringify(result));
  return result;
  } catch (err: any) {
    console.error(`❌ Error in syncRefundsForChunk:`, err);
    console.error("Stack trace:", err.stack);
    throw err;
  }
}

async function updateRefundsInDatabase(
  supabase: any,
  refunds: RefundUpdate[]
): Promise<number> {
  let updatedCount = 0;

  // Batch updates in chunks
  const chunks: RefundUpdate[][] = [];
  for (let i = 0; i < refunds.length; i += BATCH_SIZE) {
    chunks.push(refunds.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    for (const refund of chunk) {
      // Log first 2 updates in detail
      const shouldLogDetail = updatedCount < 2;

      if (shouldLogDetail) {
        console.log(`💸 [DETAILED] Updating SKU ${refund.sku} with refunded_qty=${refund.refunded_qty}, refund_date=${refund.refund_date}, refunded_amount_dkk=${refund.refunded_amount_dkk.toFixed(2)}`);
      }

      console.log(`💾 [UPDATE] Full refund object:`, JSON.stringify(refund));
      console.log(`💾 [UPDATE] Attempting to update SKU ${refund.sku}: refunded_qty=${refund.refunded_qty}, refund_date=${refund.refund_date}, refunded_amount_dkk=${refund.refunded_amount_dkk}`);

      // Build update object - always include all fields
      const updateData: any = {
        refunded_qty: refund.refunded_qty,
        refunded_amount_dkk: refund.refunded_amount_dkk,
        refund_date: refund.refund_date,
        cancelled_qty: refund.cancelled_qty || 0,
        cancelled_amount_dkk: refund.cancelled_amount_dkk || 0,
      };

      const { error, data } = await supabase
        .from("skus")
        .update(updateData)
        .match({
          shop: refund.shop,
          order_id: refund.order_id,
          sku: refund.sku,
        })
        .select();

      if (error) {
        console.error(`❌ Error updating SKU ${refund.sku}:`, JSON.stringify(error));
      } else {
        console.log(`✅ [UPDATE] Successfully updated SKU ${refund.sku}, rows affected:`, data?.length || 0);
        updatedCount++;
        if (shouldLogDetail) {
          console.log(`✅ [DETAILED] Updated data:`, JSON.stringify(data));
        }
      }
    }
  }

  console.log(`✅ Updated ${updatedCount} SKUs with refund data`);
  return updatedCount;
}
