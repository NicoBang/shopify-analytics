import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req: Request): Promise<Response> => {
  const env = {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };

  console.log("Environment variables check:");
  console.log(JSON.stringify(env, null, 2));

  return new Response(
    JSON.stringify({
      message: "Environment variables test",
      env: {
        SUPABASE_URL: env.SUPABASE_URL || "MISSING",
        SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || "MISSING",
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || "MISSING",
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
