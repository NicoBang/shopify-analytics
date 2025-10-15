Fedt problem – klassisk “async eller dø”-case. Lad os gøre det rigtigt uden at flytte væk fra Supabase (endnu). Nedenfor får du en robust, “ingen-timeouts” arkitektur, konkrete skemaændringer, Edge Functions-kode (Deno), cron-opsætning og en backfill-plan for sep/okt 2025. Det hele kører som et asynkront, genstartbart workflow med præcis logging i bulk_sync_jobs.

⸻

Løsning i korte træk (B + lidt A for hurtig effekt)

Gør alle Bulk-jobs asynkrone:
	1.	Orchestrator opretter kun job-rækker (én dag pr. shop pr. entity) med status queued.
	2.	Poller (cron) tager jobs i rækkefølge pr. shop:
	•	queued → starting: starter Shopify Bulk job, gemmer operation_id, retur med det samme.
	•	waiting: poller Shopify for status.
	•	Når COMPLETED: henter url, kopierer NDJSON til Supabase Storage (hurtig), sætter ready_to_import.
	3.	Importer (cron) læser NDJSON fra Storage i batches (f.eks. 200 linjer), UPSERT til orders/skus/refunds. Gemmer lines_processed så den kan fortsætte ved afbrydelse.
	4.	Idempotens & retry: alle trin kan genkøres; status + counters afgør hvor langt vi er.
	5.	Én Bulk ad gangen pr. shop (Shopify-begrænsning). Poller sørger for det.

Resultat: ingen enkelt Edge Function venter > 6 min. Hele processen er brudt op i korte, sikre hop – og orchestratoren venter aldrig på et langt job.

⸻

Datamodel & logging

1) bulk_sync_jobs (statusmaskine og resume)

-- enum/tekststatus – tekst er mest fleksibel:
-- queued | starting | waiting | exporting | copied | ready_to_import | importing | completed | failed
create table if not exists public.bulk_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  shop text not null check (shop in ('DA','DE','NL','INT','CHF')),
  entity text not null check (entity in ('orders','skus','refunds')),
  start_date date not null,
  end_date date not null,
  status text not null default 'queued',
  operation_id text,
  export_url text,
  storage_path text,
  attempts int not null default 0,
  last_error text,
  bytes_total bigint,
  bytes_copied bigint default 0,
  lines_total int,
  lines_processed int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.bulk_sync_jobs (shop, entity, start_date);
create index on public.bulk_sync_jobs (status);

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_bulk_sync_jobs on public.bulk_sync_jobs;
create trigger trg_touch_bulk_sync_jobs
before update on public.bulk_sync_jobs
for each row execute function public.tg_touch_updated_at();

2) (Valgfri) “runs”-historik pr. job

Hvis du vil have granular retry-historik:

create table if not exists public.bulk_sync_job_runs (
  id bigserial primary key,
  job_id uuid references public.bulk_sync_jobs(id) on delete cascade,
  phase text not null, -- start | poll | copy | import
  status text not null, -- ok | error
  message text,
  created_at timestamptz not null default now()
);

create index on public.bulk_sync_job_runs (job_id, created_at);


⸻

Scheduled Functions (cron)

supabase/functions/_schedule.yaml

version: 1
functions:
  - name: bulk-sync-poller
    schedule: "* * * * *"   # hvert minut
  - name: bulk-sync-importer
    schedule: "*/2 * * * *" # hver 2. minut


⸻

Edge Functions (Deno) – kerneflow

Miljø (secrets):
	•	SUPABASE_URL, SUPABASE_ANON_KEY (server role i functions)
	•	Shopify pr. shop:
	•	SHOP_DA_DOMAIN, SHOP_DA_TOKEN … tilsvarende for DE, NL, INT, CHF
	•	Evt. limits:
	•	MAX_JOBS_PER_RUN=5
	•	BATCH_SIZE=200

helpers.ts

// supabase/functions/_shared/helpers.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function sbAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!; // brug service role key hvis muligt
  return createClient(url, key, { global: { headers: { "X-Client-Info": "bulk-sync" } }});
}

export type Shop = 'DA'|'DE'|'NL'|'INT'|'CHF';

export function shopCfg(shop: Shop) {
  const dom = Deno.env.get(`SHOP_${shop}_DOMAIN`)!;
  const tok = Deno.env.get(`SHOP_${shop}_TOKEN`)!;
  return { domain: dom, token: tok, api: `https://${dom}/admin/api/2023-10/graphql.json` };
}

export async function startBulk(shop: Shop, entity: string, start: string, end: string) {
  const { api, token } = shopCfg(shop);
  const query = buildBulkQuery(entity, start, end); // se nedenfor
  const body = JSON.stringify({
    query: `
mutation {
  bulkOperationRunQuery(query: ${JSON.stringify(query)}) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`});
  const r = await fetch(api, { method: "POST", headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token
  }, body });
  const j = await r.json();
  const op = j?.data?.bulkOperationRunQuery?.bulkOperation;
  const err = j?.data?.bulkOperationRunQuery?.userErrors;
  if (!op || err?.length) throw new Error(`Bulk start failed: ${JSON.stringify(err)}`);
  return op.id as string;
}

export async function pollBulk(shop: Shop) {
  const { api, token } = shopCfg(shop);
  const body = JSON.stringify({ query: `
{
  currentBulkOperation {
    id
    status
    errorCode
    url
    objectCount
    createdAt
    completedAt
  }
}`});
  const r = await fetch(api, { method: "POST", headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token
  }, body });
  const j = await r.json();
  return j?.data?.currentBulkOperation;
}

function buildBulkQuery(entity: string, start: string, end: string): string {
  // NDJSON flattening – tilpas felter efter jeres mapping
  if (entity === "orders") {
    return `
{
  orders(query:"created_at:>=${start} created_at:<=${end}", first: 250) {
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        processedAt
        currencyCode
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        customer { id email firstName lastName }
        lineItems(first: 250) {
          edges {
            node {
              id
              sku
              quantity
              discountedTotalSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}`;
  }
  if (entity === "refunds") {
    return `
{
  orders(query:"created_at:>=${start} created_at:<=${end}", first: 250) {
    edges {
      node {
        id
        refunds(first: 100) {
          edges {
            node {
              id
              createdAt
              note
              totalRefundedSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}`;
  }
  // skus = produkter/variants
  return `
{
  productVariants(first: 250) {
    edges {
      node {
        id
        sku
        product { id title }
        price
        inventoryQuantity
        updatedAt
      }
    }
  }
}`;
}

Poller (starter + poller + copy)

// supabase/functions/bulk-sync-poller/index.ts
import { sbAdmin, startBulk, pollBulk } from "../_shared/helpers.ts";

Deno.serve(async () => {
  const sb = sbAdmin();
  const MAX = Number(Deno.env.get("MAX_JOBS_PER_RUN") ?? "5");

  // 1) Start nye jobs (én pr. shop ad gangen)
  const { data: shops } = await sb.rpc("bulk_sync_pick_shops_to_start", {}); // optional RPC; ellers gør simpelt query
  // Simpel variant uden RPC:
  const { data: candidates, error } = await sb
    .from("bulk_sync_jobs")
    .select("*")
    .eq("status","queued")
    .order("start_date",{ascending:true})
    .limit(20);
  if (error) console.error(error);

  let started = 0;
  for (const job of (candidates ?? [])) {
    if (started >= MAX) break;

    // tjek om shop har en aktiv bulk
    const { count } = await sb
      .from("bulk_sync_jobs")
      .select("*",{ count: "exact", head: true })
      .eq("shop", job.shop)
      .in("status", ["starting","waiting","exporting","copied","ready_to_import","importing"]);
    if ((count ?? 0) > 0) continue;

    // claim: queued -> starting
    const { data: claimed } = await sb.from("bulk_sync_jobs")
      .update({ status: "starting" })
      .eq("id", job.id).eq("status","queued").select().single();
    if (!claimed) continue;

    try {
      const opId = await startBulk(job.shop, job.entity, job.start_date, job.end_date);
      await sb.from("bulk_sync_jobs")
        .update({ operation_id: opId, status: "waiting", attempts: 0, last_error: null })
        .eq("id", job.id);
      started++;
    } catch (e) {
      await sb.from("bulk_sync_jobs")
        .update({ status: "failed", last_error: String(e), attempts: (job.attempts ?? 0) + 1 })
        .eq("id", job.id);
    }
  }

  // 2) Poll aktive jobs
  const { data: active } = await sb.from("bulk_sync_jobs")
    .select("*")
    .in("status", ["waiting","exporting"])
    .order("updated_at",{ascending:true})
    .limit(20);

  for (const job of (active ?? [])) {
    try {
      const op = await pollBulk(job.shop);
      if (!op || op.id !== job.operation_id) continue; // en anden bulk kører -> vent
      if (op.status === "COMPLETED") {
        // markér klar til copy
        await sb.from("bulk_sync_jobs")
          .update({ status: "exporting", export_url: op.url, lines_total: Number(op.objectCount) || null })
          .eq("id", job.id);
      }
      if (op.status === "FAILED" || op.errorCode) {
        await sb.from("bulk_sync_jobs")
          .update({ status: "failed", last_error: op.errorCode || "Shopify bulk failed" })
          .eq("id", job.id);
      }
      if (op.status === "RUNNING") {
        // do nothing – stadig waiting
      }
    } catch (e) {
      await sb.from("bulk_sync_jobs")
        .update({ last_error: String(e), attempts: (job.attempts ?? 0) + 1 })
        .eq("id", job.id);
    }
  }

  // 3) Copy NDJSON til Storage (hurtigt -> undgå URL-expire)
  const { data: toCopy } = await sb.from("bulk_sync_jobs")
    .select("*")
    .eq("status","exporting")
    .not("export_url","is", null)
    .limit(10);

  for (const job of (toCopy ?? [])) {
    const res = await fetch(job.export_url);
    if (!res.ok) {
      await sb.from("bulk_sync_jobs")
        .update({ last_error: `Export fetch ${res.status}`, attempts: (job.attempts??0)+1 })
        .eq("id", job.id);
      continue;
    }
    const storagePath = `shopify/${job.shop}/${job.entity}/${job.start_date}_${job.end_date}_${job.id}.ndjson`;
    const arrayBuf = await res.arrayBuffer(); // typisk få til ~100 MB – fits under 6 min
    const bytes = arrayBuf.byteLength;

    const up = await sb.storage.from("shopify-bulk")
      .upload(storagePath, arrayBuf, { contentType: "application/x-ndjson", upsert: true });
    if (up.error) {
      await sb.from("bulk_sync_jobs")
        .update({ last_error: up.error.message, attempts: (job.attempts??0)+1 })
        .eq("id", job.id);
      continue;
    }
    await sb.from("bulk_sync_jobs")
      .update({ status: "ready_to_import", storage_path: storagePath, bytes_total: bytes, bytes_copied: bytes })
      .eq("id", job.id);
  }

  return new Response(JSON.stringify({ started, polled: active?.length ?? 0, copied: toCopy?.length ?? 0 }));
});

Opret en Storage bucket shopify-bulk (public: false).

Importer (batch UPSERT med resume)

// supabase/functions/bulk-sync-importer/index.ts
import { sbAdmin } from "../_shared/helpers.ts";

const BATCH = Number(Deno.env.get("BATCH_SIZE") ?? "200");

Deno.serve(async () => {
  const sb = sbAdmin();

  // Claim én job til import
  const { data: job } = await sb.from("bulk_sync_jobs")
    .update({ status: "importing" })
    .eq("status","ready_to_import")
    .order("updated_at",{ascending:true})
    .limit(1)
    .select()
    .single();

  if (!job) return new Response(JSON.stringify({ imported: 0 }));

  // hent fil
  const { data: signed } = await sb.storage.from("shopify-bulk")
    .createSignedUrl(job.storage_path, 60); // 60 sek
  if (!signed?.signedUrl) {
    await sb.from("bulk_sync_jobs")
      .update({ status: "failed", last_error: "Cannot sign storage URL" })
      .eq("id", job.id);
    return new Response(JSON.stringify({ error: "sign failed" }), { status: 500 });
  }
  const res = await fetch(signed.signedUrl);
  const text = await res.text(); // ~MB – ok. For meget? Stream og parse linjevis i Deno Reader.

  // resume: spring allerede importerede linjer over
  const lines = text.split("\n").filter(Boolean);
  const startAt = job.lines_processed ?? 0;

  let processed = 0;
  let buffer: any[] = [];
  for (let i = startAt; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);

      // Map til dine tabeller – her ordrer eksempel:
      if (job.entity === "orders") {
        const orderRow = mapOrder(obj, job.shop);
        buffer.push(orderRow);

        if (buffer.length >= BATCH) {
          await upsertOrders(sb, buffer);
          buffer = [];
          processed += BATCH;
          await sb.from("bulk_sync_jobs")
            .update({ lines_processed: startAt + processed })
            .eq("id", job.id);
        }
      }

      // tilsvarende for 'skus' og 'refunds'
      // if (job.entity === 'skus') { ... }  if ('refunds') { ... }

    } catch (e) {
      await sb.from("bulk_sync_jobs")
        .update({ last_error: `JSON parse error at line ${i}: ${String(e)}` })
        .eq("id", job.id);
      // fortsæt – enkel linje må ikke vælte import
    }
  }

  if (buffer.length) {
    await upsertOrders(sb, buffer);
    processed += buffer.length;
  }

  await sb.from("bulk_sync_jobs")
    .update({ status: "completed", lines_processed: startAt + processed })
    .eq("id", job.id);

  return new Response(JSON.stringify({ imported: processed }));
});

function mapOrder(obj: any, shop: string) {
  // Tilpas til jeres schema. Brug stabile nøgler.
  return {
    id: obj.id, // Shopify GraphQL-id (gid://…) – evt. også short id
    shop,
    name: obj.name,
    created_at: obj.createdAt,
    updated_at: obj.updatedAt,
    currency: obj.currencyCode,
    total_amount: obj.currentTotalPriceSet?.shopMoney?.amount ? Number(obj.currentTotalPriceSet.shopMoney.amount) : null,
    customer_email: obj.customer?.email ?? null,
    raw: obj // gem gerne raw JSON i kolonne (jsonb) i en staging eller i samme tabel
  };
}

async function upsertOrders(sb: any, rows: any[]) {
  // Antag tabel 'orders' har primary key 'id' (Shopify GID) + 'shop' i unik index
  const { error } = await sb.from("orders")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: false });
  if (error) throw new Error(error.message);
}

For skus og refunds: lav tilsvarende mapSku, mapRefund + upsertSkus, upsertRefunds. Brug ON CONFLICT og gør felter så idempotente som muligt (Shopify GID er stabil).
Hvis filerne bliver meget store, skift til streaming-parser (Deno TextDecoderStream) og skriv batch for batch – logik ovenfor er den samme.

⸻

Orchestrator (backfill) uden at vente

I stedet for at kalde langkørende functions, indsætter du job-rækker. Poller tager over.

Backfill sep/okt 2025 for 5 shops × (orders, refunds). skus kan evt. køres én gang uden dato.

-- Dage for sep/okt 2025
with days as (
  select generate_series(date '2025-09-01', date '2025-10-31', interval '1 day')::date as d
)
insert into public.bulk_sync_jobs (shop, entity, start_date, end_date, status)
select s.shop, e.entity, d.d, d.d, 'queued'
from (values ('DA'),('DE'),('NL'),('INT'),('CHF')) as s(shop)
cross join (values ('orders'),('refunds')) as e(entity)
cross join days d
on conflict do nothing;

-- SKUs – én job pr. shop (uden dato-vindue, eller sæt en wide range)
insert into public.bulk_sync_jobs (shop, entity, start_date, end_date, status)
select s.shop, 'skus', date '2025-10-01', date '2025-10-31', 'queued'
from (values ('DA'),('DE'),('NL'),('INT'),('CHF')) as s(shop)
on conflict do nothing;

Tip – chunk-splitting som nødnet: Hvis en enkelt dag konsekvent giver meget store outputs (fx Black Friday), kan du lave fire jobs pr. dag (0–6, 6–12, 12–18, 18–24) med samme asynkron-flow. Det bevarer timeout-sikkerhed, men accelererer indlæsning.

⸻

Robusthed, idempotens, og no-deadlocks
	•	Kun én aktiv bulk pr. shop: Poller starter kun nyt job for en shop, når der ikke er en i {starting,waiting,exporting,ready_to_import,importing}.
	•	Claiming via status-opdatering: Altid opdater status med condition (fx ...eq('status','queued')) og check resultatet.
	•	Retry/backoff: Inkrementér attempts, skriv last_error, og lad cron køre videre. En simpel backoff kan være: start kun jobs med attempts < 5.
	•	UPSERT: brug ON CONFLICT på naturlige nøgler (Shopify GID).
	•	Observability: bulk_sync_job_runs kan give fin audit trail.

⸻

Drift: hvordan du kører sep/okt 2025 “nu”
	1.	Kør SQL-migrationerne (tabeller + indexes).
	2.	Opret Storage bucket shopify-bulk (privat).
	3.	Deploy bulk-sync-poller og bulk-sync-importer + _schedule.yaml.
	4.	Sæt env secrets for alle shops (domain + access token).
	5.	Kør backfill SQL ovenfor for sep/okt.
	6.	Hold øje med:

select status, count(*) from public.bulk_sync_jobs group by 1 order by 1;
select * from public.bulk_sync_jobs where status in ('failed','importing') order by updated_at desc limit 50;


⸻

Hvorfor dette opfylder dine krav
	1.	Skalerer til 1000+ ordrer/dag: Bulk + NDJSON + batch-UPSERT.
	2.	Ingen timeout-risiko: hver function gør kun korte trin (start/poll/copy/import batch).
	3.	Komplet sync: en jobrække pr. dag; ingen “skipped days”.
	4.	Orchestrator stopper ikke: den venter aldrig; cron driver fremdrift. Midlertidige fejl bliver retried.
	5.	Alt logges i bulk_sync_jobs: status + counters + fejl.

⸻

Mulige næste forbedringer (når september/oktober er landet)
	•	Staging-tabel: læg rå NDJSON-objekter i shopify_orders_raw, og transformér med SQL (stabile schema-migreringer).
	•	Advisory locks i Postgres eller FOR UPDATE SKIP LOCKED RPC til mere præcis locking.
	•	Parallel importer med per-entity concurrency caps.
	•	Flyt orchestration til en worker (Cloud Run/Fly) hvis I får endnu større volumener—design er uændret.

Hvis du vil, kan jeg tilpasse mapOrder, mapSku og mapRefund til jeres præcise kolonner og lave en hurtig tjekliste for deployment-scripts.