import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthenticatedClient } from "../_shared/supabase.ts";

/**
 * Smart Refunds Sync
 *
 * Automatically decides whether to use regular or chunked sync
 * based on order count.
 *
 * Thresholds:
 * - < 300 orders: Use bulk-sync-refunds (fast, single batch)
 * - >= 300 orders: Use bulk-sync-refunds-chunked (slower, but won't timeout)
 */

interface SmartSyncRequest {
  shop: string;
  startDate: string;
  endDate: string;
  jobId?: string;
  includeRefunds?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  try {
    const { shop, startDate, endDate, jobId, includeRefunds }: SmartSyncRequest = await req.json();

    console.log(`🧠 Smart refunds sync: ${shop} ${startDate} → ${endDate}`);

    const supabase = createAuthenticatedClient();

    // Check order count
    const { count, error: countError } = await supabase
      .from("orders")
      .select("order_id", { count: "exact", head: true })
      .eq("shop", shop)
      .gte("created_at", `${startDate}T00:00:00Z`)
      .lte("created_at", `${endDate}T23:59:59Z`);

    if (countError) {
      throw new Error(`Failed to count orders: ${countError.message}`);
    }

    const orderCount = count || 0;
    console.log(`📊 Found ${orderCount} orders`);

    // Decide which function to use
    const useChunked = orderCount >= 300;
    const functionName = useChunked ? "bulk-sync-refunds-chunked" : "bulk-sync-refunds";

    console.log(`→ Using ${functionName} (threshold: ${orderCount >= 300 ? 'chunked' : 'regular'})`);

    // Call the appropriate function
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop,
        startDate,
        endDate,
        jobId,
        includeRefunds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${functionName} failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    return new Response(
      JSON.stringify({
        ...result,
        strategy: useChunked ? "chunked" : "regular",
        orderCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Smart sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
