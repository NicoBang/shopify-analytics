import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const CURRENCY_RATES = {
  DKK: 1.0,
  EUR: 7.46,
  CHF: 6.84,
};

const SHOPIFY_API_VERSION = "2025-01";

interface RefundAmountUpdate {
  shop: string;
  order_id: string;
  sku: string;
  old_amount: number;
  new_amount: number;
  refunded_amount_dkk: number;
}

// ✅ SAFE: Only updates refunded_amount_dkk, nothing else
Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { startDate, endDate, shop, dryRun = true } = await req.json();

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: "startDate and endDate required" }), { status: 400 });
    }

    console.log(`🔄 Backfilling refunded_amount_dkk for ${startDate} to ${endDate} (shop: ${shop || "all"})`);
    console.log(`⚠️ DRY RUN: ${dryRun ? "YES - no changes will be made" : "NO - will update database"}`);

    // 1. Get all SKUs with refunds in period
    let query = supabase
      .from("skus")
      .select("shop, order_id, sku, refunded_qty, refunded_amount_dkk, refund_date")
      .gte("refund_date", `${startDate}T00:00:00Z`)
      .lte("refund_date", `${endDate}T23:59:59Z`)
      .gt("refunded_qty", 0);

    if (shop) {
      query = query.eq("shop", shop);
    }

    const { data: skusWithRefunds, error: skuError } = await query;

    if (skuError) {
      console.error("Failed to fetch SKUs:", skuError);
      return new Response(JSON.stringify({ error: skuError.message }), { status: 500 });
    }

    if (!skusWithRefunds || skusWithRefunds.length === 0) {
      console.log("✅ No SKUs with refunds found in period");
      return new Response(JSON.stringify({ success: true, skusChecked: 0, updatesNeeded: 0 }), { status: 200 });
    }

    console.log(`📦 Found ${skusWithRefunds.length} SKUs with refunds`);

    // Group by order_id to minimize Shopify API calls
    const orderIds = [...new Set(skusWithRefunds.map(s => s.order_id))];
    console.log(`📋 ${orderIds.length} unique orders to process`);

    const updates: RefundAmountUpdate[] = [];

    // 2. Process each order
    for (const orderId of orderIds) {
      const orderSkus = skusWithRefunds.filter(s => s.order_id === orderId);
      const orderShop = orderSkus[0].shop;

      // Get Shopify token
      const token = getShopifyToken(orderShop);
      if (!token) {
        console.error(`❌ No token for shop ${orderShop}`);
        continue;
      }

      // Get tax_rate from database
      const { data: orderData } = await supabase
        .from("orders")
        .select("tax_rate")
        .eq("order_id", orderId)
        .single();

      const taxRate = orderData?.tax_rate || 0.25;

      // Fetch refunds from Shopify
      const url = `https://${orderShop}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/refunds.json`;
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });

      if (!res.ok) {
        console.error(`❌ Failed to fetch refunds for ${orderId}: ${res.status}`);
        continue;
      }

      const json = await res.json();
      const refunds = json.refunds || [];

      // Calculate correct refunded_amount_dkk for each SKU
      for (const sku of orderSkus) {
        const correctAmount = calculateRefundedAmount(refunds, sku.sku, taxRate);

        // Only update if different
        if (Math.abs(correctAmount - (sku.refunded_amount_dkk || 0)) > 0.01) {
          updates.push({
            shop: orderShop,
            order_id: orderId,
            sku: sku.sku,
            old_amount: sku.refunded_amount_dkk || 0,
            new_amount: correctAmount,
            refunded_amount_dkk: correctAmount,
          });

          console.log(`  📝 ${orderId} / ${sku.sku}: ${sku.refunded_amount_dkk?.toFixed(2) || '0.00'} DKK → ${correctAmount.toFixed(2)} DKK`);
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n✅ Analysis complete: ${updates.length} updates needed out of ${skusWithRefunds.length} SKUs`);

    if (updates.length === 0) {
      return new Response(JSON.stringify({ success: true, skusChecked: skusWithRefunds.length, updatesNeeded: 0 }), { status: 200 });
    }

    if (dryRun) {
      console.log(`⚠️ DRY RUN - no changes made. Set dryRun: false to apply updates`);
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          skusChecked: skusWithRefunds.length,
          updatesNeeded: updates.length,
          preview: updates.slice(0, 10),
        }),
        { status: 200 }
      );
    }

    // 3. Apply updates in batches
    let totalUpdated = 0;
    const batchSize = 100;

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);

      for (const update of batch) {
        const { error } = await supabase
          .from("skus")
          .update({ refunded_amount_dkk: update.refunded_amount_dkk })
          .eq("shop", update.shop)
          .eq("order_id", update.order_id)
          .eq("sku", update.sku);

        if (error) {
          console.error(`❌ Failed to update ${update.order_id}/${update.sku}:`, error);
        } else {
          totalUpdated++;
        }
      }

      console.log(`✅ Updated ${Math.min(i + batchSize, updates.length)}/${updates.length} SKUs`);
    }

    console.log(`\n✅ Backfill complete: ${totalUpdated} SKUs updated`);

    return new Response(
      JSON.stringify({
        success: true,
        skusChecked: skusWithRefunds.length,
        skusUpdated: totalUpdated,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("❌ Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

function getShopifyToken(shop: string): string | null {
  const tokens: Record<string, string> = {
    "pompdelux-da.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DA") || "",
    "pompdelux-de.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_DE") || "",
    "pompdelux-nl.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_NL") || "",
    "pompdelux-int.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_INT") || "",
    "pompdelux-chf.myshopify.com": Deno.env.get("SHOPIFY_TOKEN_CHF") || "",
  };
  return tokens[shop] || null;
}

// ✅ Same calculation logic as bulk-sync-refunds (lines 340-394)
function calculateRefundedAmount(refunds: any[], targetSku: string, taxRate: number): number {
  let totalAmount = 0;

  for (const refund of refunds) {
    const refundLineItems = refund.refund_line_items || [];
    const transactions = refund.transactions || [];

    // Calculate actual refund amount from transactions
    const actualRefundAmount = transactions
      .filter((t: any) => t.kind === "refund" && t.status === "success")
      .reduce((sum: number, t: any) => sum + parseFloat(t.amount || "0"), 0);

    // Calculate theoretical total
    const totalTheoretical = refundLineItems.reduce((sum: number, item: any) => {
      const subtotal = parseFloat(item.subtotal_set?.shop_money?.amount || "0");
      const tax = parseFloat(item.total_tax_set?.shop_money?.amount || "0");
      return sum + subtotal + tax;
    }, 0);

    // Find this SKU in refund line items
    for (const item of refundLineItems) {
      const sku = item.line_item?.sku || "";
      // ⚠️ CRITICAL: SKU is already formatted as "20178\\98/104" in Shopify
      // DO NOT append variant_title again - it's already included!

      if (sku !== targetSku) continue;

      const quantity = item.quantity || 0;
      if (quantity === 0) continue;

      const subtotal = parseFloat(item.subtotal_set?.shop_money?.amount || "0");
      const tax = parseFloat(item.total_tax_set?.shop_money?.amount || "0");
      const currency = item.subtotal_set?.shop_money?.currency_code || "DKK";
      const rate = CURRENCY_RATES[currency as keyof typeof CURRENCY_RATES] || 1;

      // Get transaction currency
      const firstTransaction = transactions.find((t: any) => t.kind === "refund" && t.status === "success");
      const transactionCurrency = firstTransaction?.currency || currency;
      const transactionRate = CURRENCY_RATES[transactionCurrency as keyof typeof CURRENCY_RATES] || 1;

      // 1. Convert actualRefundAmount from original currency to DKK INCL VAT
      const actualRefundAmountDkk = actualRefundAmount * transactionRate;

      // 2. Calculate proportion based on INCL VAT (subtotal + tax)
      const itemTotal = subtotal + tax;
      const proportion = totalTheoretical > 0 ? itemTotal / totalTheoretical : 0;

      // 3. Distribute proportionally in DKK INCL VAT
      const actualInclVatDkk = actualRefundAmountDkk * proportion;

      // 4. Remove VAT to get DKK EX VAT
      const amountDkk = actualInclVatDkk / (1 + taxRate);

      totalAmount += amountDkk;
    }
  }

  return totalAmount;
}
