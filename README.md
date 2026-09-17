## Quick run
```bash
cd platform && cd backend && npm run dev
cd platform && cd frontend && npm run dev
```

# Conservation Reporting Platform

The research artefact for *Improving Endangered Species Conservation Reporting Through AI and Webxw
Data Integration*. Vue 3 (Vite) frontend + Hono backend, in one repo.

**Stages 1 and 2 are built** — Koala in New South Wales, Jan–Jun 2025, through two sources:
Atlas of Living Australia (2,865 records) and iNaturalist (784), harvested end to end into one
canonical record and served through three views. See `../Build Scope.md` for what each stage was
for and what it found; `../CLAUDE.md` is the authority on the research question and the ethics
pillars.

```
platform/
├── frontend/   Vue 3 · TypeScript · Vite · Tailwind v4 · shadcn-vue · Pinia · Vue Router · Axios
└── backend/    Hono · Node · TypeScript · Supabase client
```

## Ingestion

Harvesting is a CLI job, not an HTTP route — it is rate-limited traffic against someone else's
service and should not be triggerable by a page refresh.

```bash
cd backend
npm run ingest -- harvest koala-nsw-2025h1        # ALA        (~45s, 39 requests)
npm run ingest -- harvest koala-nsw-2025h1-inat   # iNaturalist (~6s,  6 requests)
npm run ingest -- adapt <harvest>  # re-derive canonical records from the frozen snapshot (~1s)
npm run ingest -- report <harvest> # print the corpus report for the newest run
npm run ingest -- runs <harvest>   # list runs with their corpus hashes
```

## Adding a source

`sources/registry.ts` is the seam. A source provides two functions — harvest and freeze, then
turn frozen bytes into canonical records — and everything else is shared: rate limiting, the
snapshot store, the canonical record, the analysis, all three views.

```
src/ingestion/sources/
├── types.ts       the two-function contract every source implements
├── registry.ts    the seam: source key -> module
├── ala/           Darwin Core, offset paging, 5,000-record cap
└── inaturalist/   not Darwin Core, id-cursor paging, no cap, per-record licensing
```

Region and species are named source-neutrally in `config/`; each source translates them into
whatever identifier it uses (`cl22:"New South Wales"` versus `place_id=6825`). A harvest
definition never has to know which.

The two sources differ enough to be a real test of that: iNaturalist mapped in with three
canonical additions and **zero unmapped fields**, and its cursor paging needed none of the date
partitioning ALA's silent truncation forced. The partitioning was a property of ALA, not of
harvesting — what transferred was the discipline of counting before paging and reconciling after.

`harvest` and `adapt` are separate on purpose. The raw API response is written to disk verbatim
before anything parses it, so when the canonical shape changes — which it did during Stage 1 — the
whole corpus is re-derived in about a second with no network traffic, and the bytes stay identical
across schema revisions.

Two runs of the same harvest produce the same `corpusHash` when the source has not moved. That is
the concrete form of the reproducibility claim, and it is printed by `runs`.

```
backend/
├── data/snapshots/<harvest>/<runId>/    manifest.json + pages/ — frozen, versioned, committed
├── data/canonical/<harvest>/<runId>.json  derived; gitignored, rebuilt by `adapt`
└── src/ingestion/
    ├── config/       species, harvest windows, politeness — seeded from config, not hard-coded
    ├── http/         per-host rate limiting + identifying User-Agent (ethics pillar 1)
    ├── snapshot/     verbatim raw responses, run metadata, content hashes
    ├── sources/ala/  bespoke adapter: ALA's schema, paging and quirks
    ├── canonical/    the shared record every source maps into, plus its mapping trace
    ├── privacy/      contributor pseudonyms (pillar 2), coordinate fuzzing (pillar 4)
    └── analysis/     field coverage, free-text substance, resource breakdown
```

### Things ALA does that the adapter absorbs

Each was found against the live API, and each would have produced a silently wrong result if
guessed. The first is the one that matters beyond ALA.

- **Only the first 5,000 records of a query are reachable, and overshooting returns HTTP 200 with
  an empty page rather than an error.** The harvester partitions the window into slices under the
  cap, counts each before paging it, and reconciles after; `complete` is false unless every slice
  balanced.
- `pageSize` caps at 100 — 200 and above return HTTP 503.
- Paging is only reproducible with an explicit `sort=id`; the default relevance sort has no
  guaranteed tiebreak. `sort=uuid` is rejected with HTTP 400.
- The record id is requested as `id` and returned as `uuid`; requesting `uuid` returns nothing.
- Fields outside the default view arrive nested under `otherProperties`.
- `eventDate` is epoch milliseconds; `classs` is `class`; `month` is a zero-padded string.
- Free text is asymmetric: queryable as `occurrenceRemarks`, returned as `raw_occurrenceRemarks`.
- Unpopulated fields are omitted entirely rather than returned null — which is why the mapping
  trace distinguishes *absent from source* from *empty in source*.

### The canonical record is deliberately narrow

Seventeen fields: provenance and licence, species, date, coordinates and uncertainty, locality,
basis of record, individual count, an observer pseudonym, two free-text fields, and ALA's own
assertions.

The first cut carried about forty, and thirteen of those held a single distinct value across all
2,865 records — every koala is in Animalia; every record in this window is from NSW in 2025.
Fields left out are declared in `sources/ala/adapter.ts` with the reason and the record count, and
appear in both views as a menu rather than vanishing. Restoring one is an edit plus
`npm run ingest -- adapt` — about a second, no new API traffic — because the raw responses are
frozen.

### The five views

In pipeline order — what the source sent, how it is stored, the numbers, what the numbers mean,
and what the model makes of them. Pages 1 and 2 are scoped to the run selected in the header
strip. Pages 3, 4 and 5 read across **every source fetched for the same species, region and
window** (the run's "family"), so they say the same thing whichever source is selected, and the
strip shows the scope and one chip per source instead of one run.

1. **Raw data** (`/`) — every API call in the run, each response frozen verbatim and shown as
   read-only JSON with line numbers. Request metadata sits above it: status, size, timing,
   retry count, sha256, and the exact URL. A 100-record response is ~6,000 lines, so there is a
   whole-response / one-record toggle.
2. **Schema** (`/schema`) — the data as the database holds it, laid out like a table editor:
   one tab per table, one row per record, one column per field with its declared type in the
   header and `NULL` shown as `NULL`. `sightings` is the table the pipeline fills;
   `snapshot_pages` and `harvest_runs` are what its provenance columns point at, so the chain
   back to page 1 reads as foreign keys. A missing required value or a wrong type is tinted in
   the grid; fuzzed coordinates carry a `≈`; withheld text says so. Opening a row shows the
   record by schema group with both kinds of check kept distinct — **structural** (is the field
   present, is it the declared type) as per-field badges, **semantic** (is the date in the
   future, is the point inside Australia) in a panel above — and, per field, how the value got
   there: source field, raw value, and what the adapter did (`1736899200000 → 2025-01-15`).
   "Definition" swaps the grid for the Postgres DDL generated from the same schema declaration.
   Above the tables, "About this source" is a collapsed panel holding the selected run's own
   essentials: what was fetched and whether it all arrived (slices, reconciliation, hash),
   the datasets inside the source, its free-text bands and its quality flags.
3. **Statistics** (`/statistics`) — the numbers across every source, described and not
   interpreted: one overview row per source; sightings by source, with how many each holds
   alone and how many are the same sighting seen twice; every contributing dataset across
   every source; free text per source and combined; quality flags side by side.
4. **Insights** (`/insights`) — what the numbers mean, one question per card with a verdict and
   the evidence under it: how much of a primary source reaches the aggregator and why the rest
   does not, whether content survives the trip, whether coordinate obscuring survives the trip,
   whether there is enough text for an LLM, which datasets carry the text, how precisely each
   source locates sightings, whether each source's own flags discriminate anything. All computed
   from the family and the joins between its members; no model output.
5. **AI analysis** (`/analysis`) — the model's reading of pages 3 and 4. The family's numbers
   are flattened into an *evidence pack* — a few hundred named metrics with ids, nothing per
   record, no text, no coordinates — and a frontier-tier model is asked what matters most to a
   practitioner and to state each insight's essence. The answer comes back through a tool
   schema citing metric ids, and the server checks it before storing it: every cited id must
   exist, and every number in the prose must be a value in the pack or a difference or ratio of
   two cited values. What fails is shown on the card as unverified, not hidden. One call per
   family, on a button press only, cached on disk with the evidence hash so a new run or a new
   classifier pass shows as "numbers have changed" rather than as a silently stale report. The
   whole pack the model was given is on the page. See **AI analysis** below.

The schema itself is declared as data in `canonical/schema.ts`, not left implicit in the
TypeScript types, so the platform can render it, check records against it and version it —
Stage 1's stated output is the schema, so it should be a thing you can look at.

Precise coordinates and observer identifiers never leave the backend on pages 2 and 3:
coordinates are reduced to ~1.1km and observer ids replaced with pseudonyms at the API boundary.

**Licensed content.** iNaturalist records are licensed per contributor, and 63% of its koala
observations are All Rights Reserved. Those are ingested, counted and analysed, but their text is
never served — `provenance.contentRedistributable` carries the answer and the API withholds the
words at the same boundary that fuzzes coordinates. The UI says a record's text is withheld rather
than rendering an empty field.

**Page 1 is the deliberate exception.** A redacted "raw data" view would misrepresent what the
source actually sent, which is the one thing that view exists to show — so the frozen response is
served verbatim, precise coordinates and observer names included. That is fine while the platform
runs locally against your own harvest and is not fine in a deployment, so it is a flag rather than
an assumption: set `INGESTION_SERVE_RAW=false` and the route returns 404 with the reason.

Ports: backend `8000`, frontend `5173`. The frontend's `VITE_API_BASE_URL` and the backend's
`ALLOWED_ORIGINS` must agree or every request fails CORS.

## Threat and condition extraction from free text

The first research product the platform generates: every substantive remark on a koala record
is read by a classifier and labelled with what it states — the animal's **condition**
(healthy, unwell, dead, not stated), the **events** it names (vehicle strike, dog attack,
disease, injury, fire, rescue or care, with joey) and whether it is about a koala at all. The
taxonomy is declared as data in `ingestion/text/taxonomy.ts` and versioned; so is the prompt.

Two classifiers implement one interface, so the same inputs and the same scorer run against
both — the Week 3 direction that an LLM has to be shown to be worth paying for:

- **keyword** — regular expressions with simple negation handling. Needs nothing.
- **llm** — Anthropic, cheap tier by default (`claude-haiku-4-5`), temperature 0, output
  forced through a tool schema, model id and prompt version written into every result. Needs
  `ANTHROPIC_API_KEY` in `backend/.env`.

Texts are scrubbed of emails, phone numbers, links and handles before either classifier sees
them, and de-duplicated by hash so "Reported to hotline" is classified once, not hundreds of
times. Runs are resumable; `--limit` caps how many new texts one invocation will spend on.

```bash
cd backend
npm run ingest -- classify koala-nsw-2025h1 --classifier keyword
npm run ingest -- classify koala-nsw-2025h1 --classifier llm --limit 200   # needs the key
npm run ingest -- evaluate --classifier keyword                           # synthetic corpus
npm run ingest -- evaluate --classifier llm
```

`evaluate` runs the Tier 1 synthetic corpus in `ingestion/text/synthetic.ts` — 48 authored
remarks with labels known by construction, spanning negation, typos, vernacular, confusable
species, mortality versus live, boilerplate and traps — and writes a report to
`data/evaluations/`. Results land as their own table (`text_classifications` on the Schema
page), as a section on Statistics, and as cards on Insights.

**Backfill.** Koala × NSW is defined one harvest per year from 2015 for both sources
(`config/harvests.ts`); `npm run ingest -- harvest koala-nsw-2024` fetches, freezes and adapts
one year. Backfill snapshot pages stay on disk and out of git; their manifests are tracked.
All twelve years of both sources were harvested complete on 11 Sep 2026 (about 250,000 ALA
records, 5,800 iNaturalist) and the keyword baseline has read every one of them.

## AI analysis

Page 5. `ingestion/synthesis/` holds it: `evidence.ts` builds the pack from the family,
`prompt.ts` is the versioned prompt and tool schema, `verify.ts` is the fact-check run on the
model's answer, `store.ts` keeps one file per family per model under `data/syntheses/`.

```bash
cd backend
npm run ingest -- synthesise koala-nsw-2025h1            # prints the checked report
npm run ingest -- synthesise koala-nsw-2025h1 --force    # regenerate even if current
```

The model defaults to `claude-opus-5` (`ANALYSIS_MODEL` overrides) — the reasoning-heavy end
of the two-tier hypothesis, with `claude-haiku-4-5` doing the bulk classification underneath.
Both need `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) in `backend/.env`. The Claude 5 tier
rejects the `temperature` parameter; every call tries temperature 0, falls back without it,
and the result records which applied.

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env   # the placeholder Supabase values are fine for the corpus pages
npm run dev            # http://localhost:8000
```

`.env`:

```txt
PORT=8000

# Supabase
SUPABASE_URL=https://project_id.supabase.co
SUPABASE_SECRET_KEY=your-secret-key

# URL - development
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173

# URL - production
# ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

Check it: `curl http://localhost:8000/api/users` → the mock users.

Scripts: `dev` (tsx watch) · `build` (tsc → `dist/`) · `start` (node `dist/index.js`) · `typecheck`.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.development   # local env files are not committed
npm run dev            # http://localhost:5173
```

`.env.development` (`.env.production` mirrors it for the real domain):

```txt
VITE_SUPABASE_URL=https://your-supabase-url.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_API_BASE_URL=http://localhost:8000/api
```

Build: `npm run build && npm run preview`. Type check: `npm run typecheck`.

Add shadcn-vue components as needed:

```bash
npx shadcn-vue@latest add button card table
```

## Layout

```
frontend/src/
├── apis/         apiClient.ts (Axios, reads VITE_API_BASE_URL) + per-resource API modules
├── components/   UserManager.vue — the wiring demo
├── lib/utils.ts  cn() helper for shadcn-vue
├── router/       vue-router; "/" → UserView
├── stores/       Pinia; userStore.ts also owns the User type
├── views/        HomeView.vue (placeholder), UserView.vue
├── App.vue       <RouterView />
└── main.ts       registers Pinia + Router

backend/src/
├── index.ts      Hono app, CORS from ALLOWED_ORIGINS, mounts /api/users
├── config.ts     Supabase client + FRONTEND_URL
└── routes/       user_routes.ts — mock data, to be replaced with Supabase queries
```

Note: `index.ts` imports routes with an explicit `.ts` extension. That works because the tsconfig
sets `allowImportingTsExtensions`, dev runs through `tsx`, and `rewriteRelativeImportExtensions`
rewrites those specifiers to `.js` on build.
