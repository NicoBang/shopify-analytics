// Supabase client utilities
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { SHOPIFY_CONFIG } from "./config.ts";

export function createAuthenticatedClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
                      Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

export async function batchUpsert<T extends Record<string, any>>(
  supabase: SupabaseClient,
  table: string,
  data: T[],
  conflictColumns: string[],
  batchSize = SHOPIFY_CONFIG.BATCH_SIZE
): Promise<{ success: boolean; error?: Error }> {
  const chunks = [];
  for (let i = 0; i < data.length; i += batchSize) {
    chunks.push(data.slice(i, i + batchSize));
  }

  for (const chunk of chunks) {
    const { error } = await supabase
      .from(table)
      .upsert(chunk, {
        onConflict: conflictColumns.join(","),
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`Error upserting to ${table}:`, error);
      return { success: false, error };
    }
  }

  return { success: true };
}