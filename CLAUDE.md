# CLAUDE.md (Clean Version)

## 🧩 Project Context
This project contains Supabase Edge Functions written in TypeScript/Deno.
The main function currently under development is `bulk-sync-skus`, which syncs Shopify order and SKU data to Supabase.

## ⚙️ Development Style
- Keep answers concise and focused.
- Never summarize or rebuild previous context.
- Always start fresh from the current user message.
- No session resume, no long historical analysis.

## 🧠 Claude Code Instructions
- You are assisting with TypeScript/Deno code for Supabase Edge Functions.
- You may read or modify files inside `supabase/functions/*`.
- Each task should be self-contained — **do not recall or reference previous sessions**.
- Never write multi-page summaries.  
- Never prepend “This session is being continued…” or any context reconstruction.  

## 🚀 Task Behavior
When the user asks for help:
1. Read the relevant file(s).
2. Apply the requested change.
3. Respond with only the modified code or concise notes.
4. If a prompt is ambiguous, ask a single clarifying question — don’t guess.

## 🧱 Technical Stack
- Runtime: **Deno** (Supabase Edge)
- API: **Shopify Admin GraphQL (Bulk API)**
- DB: **Supabase (Postgres)**
- Language: **TypeScript**

## 🧹 Reset Behavior
Every new session should start clean.  
Do **not** attempt to restore context from memory, logs, or summaries.  
Do **not** produce session history overviews.

---

✅ **Key Rule:**  
> “Each message is a new context. Never summarize or rebuild prior conversation history.”

🧭 Date and Timestamp Handling Rules

Important: Different tables use different date column types — all logic and queries must respect this distinction.

🗓️ skus table
	•	created_at → DATE (no timezone)
	•	All comparisons must use "YYYY-MM-DD" format (no Z, no time offset).
	•	Always cast incoming timestamps to DATE before filtering:

    const startDate = new Date(reqBody.startDate).toISOString().split("T")[0];
const endDate = new Date(reqBody.endDate).toISOString().split("T")[0];
await supabase
  .from("skus")
  .select("*")
  .gte("created_at", startDate)
  .lte("created_at", endDate);

  ⏰ orders table
	•	created_at → TIMESTAMPTZ (timezone-aware)
	•	All comparisons must preserve full timestamp precision.
	•	Use ISO strings (with "Z") for comparisons:

    const startISO = new Date(reqBody.startDate).toISOString();
const endISO = new Date(reqBody.endDate).toISOString();
const { data } = await supabase
  .from("orders")
  .select("*")
  .gte("created_at", startISO)
  .lte("created_at", endISO);

  ⚙️ General Rules
	•	Never assume the same date precision between tables.
	•	When joining orders → skus:
	•	Match on DATE(orders.created_at) = skus.created_at
	•	or normalize both to the same day boundary.
	•	Shopify Bulk API returns timestamps → must be converted before upsert into skus.