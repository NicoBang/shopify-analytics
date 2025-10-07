import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Weekly Metadata Sync
 *
 * Purpose: Automatically sync product metadata for all shops
 * Trigger: Supabase cron job every Sunday at 02:00 Copenhagen time (01:00 UTC)
 *
 * Product metadata changes infrequently, so weekly sync is sufficient
 */

serve(async (req: Request): Promise<Response> => {
  try {
    console.log("📦 Weekly Metadata Sync: Starting...");

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
      console.error("❌ Vercel credentials not configured");
      return new Response(
        JSON.stringify({
          error: "VERCEL_API_TOKEN and VERCEL_API_URL must be configured",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`🏪 Syncing metadata for ${shops.length} shops...`);

    const metadataPromises = shops.map((shop) =>
      fetch(`${vercelUrl}/api/sync-shop?shop=${shop}&type=metadata`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      }).then(async (res) => ({
        shop,
        success: res.ok,
        status: res.status,
        data: res.ok ? await res.json().catch(() => null) : await res.text(),
      }))
    );

    const results = await Promise.all(metadataPromises);

    const successCount = results.filter((r) => r.success).length;
    console.log(`✅ Metadata sync completed: ${successCount}/${shops.length} shops successful`);

    results.forEach((result) => {
      if (!result.success) {
        console.error(`❌ ${result.shop} failed: ${result.data}`);
      }
    });

    return new Response(
      JSON.stringify({
        success: successCount === shops.length,
        timestamp: new Date().toISOString(),
        sync: {
          total: shops.length,
          successful: successCount,
          failed: shops.length - successCount,
          details: results,
        },
      }),
      {
        status: successCount === shops.length ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Weekly metadata sync exception:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
