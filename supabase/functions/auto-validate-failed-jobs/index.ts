import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Auto-Validate Failed Jobs
 *
 * Purpose: 100% automated validation of failed jobs
 * Trigger: Supabase cron job (daily at 2 AM)
 *
 * This function:
 * 1. Calls validate-failed-jobs for orders, skus, and refunds
 * 2. Marks empty days as completed
 * 3. Returns summary of real failures
 */

serve(async (req: Request): Promise<Response> => {
  try {
    console.log("🤖 Auto-validate failed jobs started...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const results = {
      orders: { updated: 0, realFailures: 0 },
      skus: { updated: 0, realFailures: 0 },
      refunds: { updated: 0, realFailures: 0 },
      shippingDiscounts: { updated: 0, realFailures: 0 },
    };

    // Validate orders
    console.log("📦 Validating order jobs...");
    try {
      const ordersResponse = await fetch(
        `${supabaseUrl}/functions/v1/validate-failed-jobs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objectType: "orders" }),
        }
      );

      if (ordersResponse.ok) {
        const ordersData = await ordersResponse.json();
        results.orders.updated = ordersData.summary?.updated || 0;
        results.orders.realFailures = ordersData.summary?.realFailures || 0;
        console.log(`  ✅ Updated: ${results.orders.updated}, Real failures: ${results.orders.realFailures}`);
      } else {
        console.error("❌ Orders validation failed:", await ordersResponse.text());
      }
    } catch (error) {
      console.error("❌ Orders validation error:", error);
    }

    // Validate SKUs
    console.log("📦 Validating SKU jobs...");
    try {
      const skusResponse = await fetch(
        `${supabaseUrl}/functions/v1/validate-failed-jobs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objectType: "skus" }),
        }
      );

      if (skusResponse.ok) {
        const skusData = await skusResponse.json();
        results.skus.updated = skusData.summary?.updated || 0;
        results.skus.realFailures = skusData.summary?.realFailures || 0;
        console.log(`  ✅ Updated: ${results.skus.updated}, Real failures: ${results.skus.realFailures}`);
      } else {
        console.error("❌ SKUs validation failed:", await skusResponse.text());
      }
    } catch (error) {
      console.error("❌ SKUs validation error:", error);
    }

    // Validate refunds
    console.log("📦 Validating refund jobs...");
    try {
      const refundsResponse = await fetch(
        `${supabaseUrl}/functions/v1/validate-failed-jobs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objectType: "refunds" }),
        }
      );

      if (refundsResponse.ok) {
        const refundsData = await refundsResponse.json();
        results.refunds.updated = refundsData.summary?.updated || 0;
        results.refunds.realFailures = refundsData.summary?.realFailures || 0;
        console.log(`  ✅ Updated: ${results.refunds.updated}, Real failures: ${results.refunds.realFailures}`);
      } else {
        console.error("❌ Refunds validation failed:", await refundsResponse.text());
      }
    } catch (error) {
      console.error("❌ Refunds validation error:", error);
    }

    // Validate shipping discounts
    console.log("🚢 Validating shipping discount jobs...");
    try {
      const shippingResponse = await fetch(
        `${supabaseUrl}/functions/v1/validate-failed-jobs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objectType: "shipping-discounts" }),
        }
      );

      if (shippingResponse.ok) {
        const shippingData = await shippingResponse.json();
        results.shippingDiscounts.updated = shippingData.summary?.updated || 0;
        results.shippingDiscounts.realFailures = shippingData.summary?.realFailures || 0;
        console.log(`  ✅ Updated: ${results.shippingDiscounts.updated}, Real failures: ${results.shippingDiscounts.realFailures}`);
      } else {
        console.error("❌ Shipping discounts validation failed:", await shippingResponse.text());
      }
    } catch (error) {
      console.error("❌ Shipping discounts validation error:", error);
    }

    // Calculate totals
    const totalUpdated = results.orders.updated + results.skus.updated + results.refunds.updated + results.shippingDiscounts.updated;
    const totalRealFailures = results.orders.realFailures + results.skus.realFailures + results.refunds.realFailures + results.shippingDiscounts.realFailures;

    console.log("\n📊 Auto-validate summary:");
    console.log(`  Empty days corrected: ${totalUpdated}`);
    console.log(`  Real failures remaining: ${totalRealFailures}`);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          totalUpdated,
          totalRealFailures,
        },
        details: results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Auto-validate error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
