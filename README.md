## Quick run
```bash
cd platform && docker compose up -d                 # Postgres + PostGIS on localhost:54329
cd platform/backend && npm run db:migrate && npm run dev
cd platform/frontend && npm run dev
```

# Conservation Reporting Platform

The research artefact for *Improving Endangered Species Conservation Reporting Through AI and Web
Data Integration*. Vue 3 (Vite) frontend + Hono backend, in one repo. `../CLAUDE.md` is the
authority on the research question, the current approach and the ethics pillars.

**State as of 3 Oct 2026.** The project was re-scoped on 2 Oct 2026 (see `../CLAUDE.md`). What
survives from the earlier koala/NSW build is the ingestion layer: harvest from the Atlas of Living
Australia, freeze the raw responses, adapt them into one canonical record. Everything downstream —
the analysis arms and the portal — is being rebuilt around the practitioner insights and is not
here yet. The earlier build is tagged `koala-archive` in this repo.

```
platform/
├── frontend/   Vue 3 · TypeScript · Vite · Tailwind v4 · shadcn-vue · Pinia · Vue Router · Axios
│               (currently a placeholder shell)
├── backend/    Hono · Node · TypeScript · Postgres (pg) · Anthropic SDK
└── docker-compose.yml   local Postgres 17 + PostGIS 3.5
```

## Ingestion

Harvesting runs from the CLI only. It is rate-limited traffic against someone else's service and
is never triggered by a page load.

```bash
cd backend
npm run ingest -- harvest [harvest]   # fetch, freeze and adapt (default: the smoke-test harvest)
npm run ingest -- adapt <harvest>     # re-derive canonical records from the frozen snapshot
npm run ingest -- report <harvest>    # print the corpus report for the newest run
npm run ingest -- runs <harvest>      # list runs with their corpus hashes
```

`harvest` and `adapt` are separate on purpose. The raw API response is written to disk verbatim
before anything parses it, so when the canonical shape changes the whole corpus is re-derived
from disk with no network traffic, and the bytes stay identical across schema revisions. Two
runs of the same harvest produce the same `corpusHash` when the source has not moved — the
concrete form of the reproducibility claim, printed by `runs`.

Harvests are currently one species per harvest (`config/harvests.ts`), optionally restricted to
a state. How a many-species, Australia-wide corpus is partitioned into harvests is open.

```
backend/
├── data/snapshots/<harvest>/<runId>/      manifest.json + pages/ — frozen raw responses
├── db/migrations/                          the database schema, applied by `npm run db:migrate`
├── src/db/                                 connection pools (platform and ai_reader) + migration runner
└── src/ingestion/
    ├── config/       species, regions, harvest windows, politeness, the Anthropic client
    ├── http/         per-host rate limiting + identifying User-Agent (ethics pillar 1)
    ├── snapshot/     verbatim raw responses, run metadata, content hashes
    ├── sources/      the two-function source contract, the registry, and ala/
    ├── canonical/    the record every source maps into, its declared schema, mapping trace
    ├── privacy/      contributor pseudonyms (pillar 2), coordinate fuzzing (pillar 4)
    ├── store/        loads adapted records into Postgres, one transaction per run
    └── analysis/     field coverage, free-text substance, contributing-dataset breakdown
```

### Things ALA does that the adapter absorbs

Each was found against the live API, and each would have produced a silently wrong result if
guessed. The first is the one that matters most.

- **Only the first 5,000 records of a query are reachable, and overshooting returns HTTP 200 with
  an empty page rather than an error.** The harvester partitions the window by date into slices
  under the cap, counts each before paging it, and reconciles after; `complete` is false unless
  every slice balanced. A single day over the cap cannot be split by date and is reported as
  incomplete — the case most likely to bite once a harvest spans many species.
- `pageSize` caps at 100 — 200 and above return HTTP 503.
- Paging is only reproducible with an explicit `sort=id`; the default relevance sort has no
  guaranteed tiebreak. `sort=uuid` is rejected with HTTP 400.
- The record id is requested as `id` and returned as `uuid`; requesting `uuid` returns nothing.
- Fields outside the default view arrive nested under `otherProperties`.
- `eventDate` is epoch milliseconds; `classs` is `class`; `month` is a zero-padded string.
- Free text is asymmetric: queryable as `occurrenceRemarks`, returned as `raw_occurrenceRemarks`.
- Unpopulated fields are omitted entirely rather than returned null — which is why the mapping
  trace distinguishes *absent from source* from *empty in source*.
- The ALA website applies default quality filters the API does not; append
  `disableAllQualityFilters=true` to a search URL to compare like with like.

### The canonical record

Provenance and licence; the taxon and its classification chain (kingdom → genus, taxon concept
id, rank); date; coordinates, uncertainty, state and locality; basis of record and individual
count; an observer pseudonym; two free-text fields; and ALA's own quality assertions. The schema
is declared as data in `canonical/schema.ts` so it can be rendered, checked against and
versioned.

Fields ALA supplies that the record does not keep are declared in `sources/ala/adapter.ts` with
the reason, so the omission stays visible and reversible. Several of those reasons were measured
on the koala/NSW corpus and should be re-checked against a many-species harvest. Restoring a
field is an edit plus `npm run ingest -- adapt`.

Precise coordinates and observer identifiers are stored, never served: coordinates are reduced
to ~1.1 km and observer ids replaced with pseudonyms at the API boundary
(`privacy/coordinates.ts`, `privacy/contributors.ts`).

## Database

Local Postgres 17 with PostGIS, from `docker-compose.yml` (image `imresamu/postgis`, the
multi-architecture build of the official one). Two schemas:

- **`corpus`** — `harvest_runs`, `datasets`, `taxa`, `occurrences` (with a PostGIS point),
  `effort_cells` (all-taxa counts per 0.1° cell and period, the reporting-rate denominator), and
  two views: `analysable_occurrences` (valid, dated, telemetry excluded, managed populations
  labelled) and `taxon_tiers` (records since 2015 and whether a taxon has ≥100 of them).
- **`analysis`** — `runs`, `insights` (the record both arms write, so they can be compared by
  key) and `ai_queries` (every query the AI arm ran, with a result hash for re-running).

`datasets.kind` is curated: tracking datasets are `telemetry` and excluded from analysis; AWC
monitoring is `managed`. The seed list is `db/migrations/003_seed_dataset_kinds.sql`.

**The AI arm's role, `ai_reader`**, can read `corpus` and nothing else: no access to `analysis`
(it must not see the calculated arm's answers), no write privilege anywhere, read-only
transactions by default, 30 s statement timeout. The privileges are what hold — verified that
switching the read-only default off still leaves every write refused. A session can lower its own
timeout, so the query tool sets the timeout per transaction rather than relying on the role
default. `npm run db:migrate` creates the role from `AI_READER_PASSWORD`.

### Model calls

`config/anthropic.ts` is the one place the key is read (`CLAUDE_API_KEY` or `ANTHROPIC_API_KEY`
in `backend/.env`, never committed) and the one place the model is chosen: `AI_MODEL`, Claude
Opus 5.5 (`claude-opus-5-5`, verified against the Models API 3 Oct 2026), overridable with
`ANALYSIS_MODEL`. On Opus 5.5 thinking is always adaptive (effort defaults to `medium`, so set it)
and forced `tool_choice` is rejected. `createDeterministic` sends temperature 0 where the model
accepts it and falls back without it where it does not — the Claude 5 tier rejects the
parameter — and reports which applied, so a run never claims a setting that was not in force.

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env   # the placeholder Supabase values are fine; database defaults need no entry
docker compose -f ../docker-compose.yml up -d
npm run db:migrate
npm run dev            # http://localhost:8000
```

Scripts: `dev` (tsx watch) · `build` (tsc → `dist/`) · `start` (node `dist/index.js`) ·
`typecheck` · `ingest` · `db:migrate`.

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

Ports: backend `8000`, frontend `5173`. The frontend's `VITE_API_BASE_URL` and the backend's
`ALLOWED_ORIGINS` must agree or every request fails CORS.

Note: the backend imports with explicit `.ts` extensions. That works because the tsconfig sets
`allowImportingTsExtensions`, dev runs through `tsx`, and `rewriteRelativeImportExtensions`
rewrites those specifiers to `.js` on build.
