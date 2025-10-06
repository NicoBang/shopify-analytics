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