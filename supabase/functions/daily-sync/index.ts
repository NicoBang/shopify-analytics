import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Daily Sync Orchestrator
 *
 * Purpose: Automatically run daily sync workflow for yesterday's date
 * Trigger: Supabase cron job at 06:00 Copenhagen time (05:00 UTC)
 *
 * Workflow:
 * 1. Sync orders & SKUs (bulk-sync-orchestrator)
 * 2. Sync refunds (bulk-sync-refund-orders)
 * 3. Call Vercel API for fulfillments (all shops in parallel)
 *
 * Note: Product metadata sync runs separately (weekly cron job)
 */

serve(async (req: Request): Promise<Response> => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    console.log("🌅 Daily Sync: Starting workflow for yesterday's date");

    // Calculate yesterday's date in YYYY-MM-DD format
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    console.log(`📅 Syncing data for date: ${dateStr}`);

    // Step 1: Trigger orders & SKUs sync via orchestrator
    console.log("📦 Step 1/3: Triggering orders & SKUs sync...");
    const ordersResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bulk-sync-orchestrator`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: dateStr,
          endDate: dateStr,
        }),
      }
    );

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text();
      console.error(`❌ Orders sync failed: ${errorText}`);
      throw new Error(`Orders sync failed: ${errorText}`);
    }

    const ordersResult = await ordersResponse.json();
    console.log(`✅ Orders sync triggered: ${JSON.stringify(ordersResult)}`);

    // Step 2: Trigger refunds sync
    console.log("💰 Step 2/3: Triggering refunds sync...");
    const refundsResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bulk-sync-refund-orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: dateStr,
          endDate: dateStr,
        }),
      }
    );

    if (!refundsResponse.ok) {
      const errorText = await refundsResponse.text();
      console.error(`❌ Refunds sync failed: ${errorText}`);
      throw new Error(`Refunds sync failed: ${errorText}`);
    }

    const refundsResult = await refundsResponse.json();
    console.log(`✅ Refunds sync triggered: ${JSON.stringify(refundsResult)}`);

    // Step 3: Trigger fulfillments sync via Vercel API (all shops in parallel)
    console.log("🚚 Step 3/3: Triggering fulfillments sync...");

    const shops = [
      "pompdelux-da.myshopify.com",
      "pompdelux-de.myshopify.com",
      "pompdelux-nl.myshopify.com",
      "pompdelux-int.myshopify.com",
      "pompdelux-chf.myshopify.com",
    ];

    const vercelToken = Deno.env.get("VERCEL_API_TOKEN");
    const vercelUrl = Deno.env.get("VERCEL_API_URL");

    if (!vercelToken || !vercelUrl) {
      console.warn("⚠️  Vercel credentials not configured - skipping fulfillments sync");
      return new Response(
        JSON.stringify({
          success: true,
          warning: "Fulfillments sync skipped - configure VERCEL_API_TOKEN and VERCEL_API_URL",
          date: dateStr,
          ordersSync: ordersResult,
          refundsSync: refundsResult,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const fulfillmentPromises = shops.map((shop) =>
      fetch(
        `${vercelUrl}/api/sync-shop?shop=${shop}&type=fulfillments&startDate=${dateStr}&endDate=${dateStr}`,
        {
          headers: { Authorization: `Bearer ${vercelToken}` },
        }
      ).then(async (res) => ({
        shop,
        success: res.ok,
        status: res.status,
        data: res.ok ? await res.json().catch(() => null) : await res.text(),
      }))
    );

    const fulfillmentResults = await Promise.all(fulfillmentPromises);

    const successCount = fulfillmentResults.filter(r => r.success).length;
    console.log(`✅ Fulfillments sync completed: ${successCount}/${shops.length} shops successful`);

    fulfillmentResults.forEach(result => {
      if (!result.success) {
        console.error(`❌ ${result.shop} failed: ${result.data}`);
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        date: dateStr,
        timestamp: new Date().toISOString(),
        ordersSync: ordersResult,
        refundsSync: refundsResult,
        fulfillmentsSync: {
          total: shops.length,
          successful: successCount,
          failed: shops.length - successCount,
          details: fulfillmentResults,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Daily sync exception:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
