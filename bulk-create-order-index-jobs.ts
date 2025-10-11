import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing env vars:", {
    SUPABASE_URL,
    SERVICE_ROLE_KEY
  });
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const shops = [
  "pompdelux-da.myshopify.com",
  "pompdelux-de.myshopify.com",
  "pompdelux-nl.myshopify.com",
  "pompdelux-int.myshopify.com",
  "pompdelux-chf.myshopify.com"
];

const start = new Date("2024-09-01");
const today = new Date();
const days: string[] = [];

while (start <= today) {
  days.push(new Date(start).toISOString().slice(0, 10));
  start.setDate(start.getDate() + 1);
}

console.log(`📅 Creating jobs from ${days[0]} to ${days[days.length - 1]} for ${shops.length} shops`);

const jobs: any[] = [];

for (const shop of shops) {
  for (const date of days) {
    jobs.push({
      shop,
      object_type: "order-index",
      start_date: date,
      status: "pending",
      created_at: new Date().toISOString()
    });
  }
}

const { error } = await supabase.from("bulk_sync_jobs").insert(jobs);

if (error) {
  console.error("❌ Failed to insert jobs:", error);
} else {
  console.log(`✅ Inserted ${jobs.length} jobs`);
}