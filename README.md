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

Harvesting runs from the CLI, or from the console's Run page on an explicit button press — it is
rate-limited traffic against someone else's service and is never triggered by a page load.

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

### Two surfaces: the portal and the console

The frontend is one app with two route groups, each with its own layout, over the same backend
data. They are split by reader, not by technology.

**The portal** (`/`) is for the practitioner. It reads the current picture by species, region
and **window** — never by run — and reads each window as **one merged corpus**: the newest run of
every source, de-duplicated, so a sighting held by two sources is counted once. Nothing in the
portal is split by source. Where a split changes how a figure should be read, it is by **record
type** instead (below). The window is in the URL
(`?window=koala__nsw__2025-01-01__2025-12-31`), so a view can be bookmarked or sent on. The strip
under the header names the run behind every source, and when the console is enabled, each has a
*trace* link that opens that run's records in the console: "clean" here means checked and
annotated, not filtered. The portal never writes: no harvest, no model call, no raw response.

1. **Overview** (`/`) — every calendar year for the species and region: the most recent full
   year as four figures (distinct sightings, animals that came into care, the share of other
   sightings describing a sick, injured or dead koala, the threat named most) and one line on
   what joining the sources adds (2025: 609 sightings held only by iNaturalist); sightings per
   year as small multiples — all distinct sightings, then government database, public sighting
   and rescue & rehab, each on its own scale; the condition rate per record type, **outside
   rescue records**; threats named per year, with the rescue/other split on hover; and every
   figure per year in a table. Text figures come from the one classifier that has read every
   year, so a trend is not a change of classifier.
2. **Sources** (`/sources`) — for one window: what joining the sources adds (each source's
   sightings, how many another source also holds, how many only it holds); kinds of record, with
   each type's remarks, condition rate and top threats; every contributing dataset after
   de-duplication, with the kinds of record it supplied; quality flags per source vocabulary.
   Flags are shown, never used to hide a record.
3. **AI analysis** (`/analysis`) — the stored model reading of the window, read-only, with the
   evidence it was given and every failed check marked. A window with none says so and links to
   the console, where it is generated. See **AI analysis** below.

**Record types** (`canonical/recordType.ts`, a canonical field since 2 Oct 2026) are the channel a
record entered through, derived by each adapter: *government database* (NSW BioNet, the Victorian
atlas), *public sighting* (iNaturalist, NatureMapr, community koala registers, ALA's own app),
*rescue & rehab* (BioNet `WR…` rehabilitation numbers, "Encounter broad:" codes, WIRES call
sheets — read from the record's content, whichever dataset carries it), *survey or research*,
*museum specimen*, and *other* for a dataset not yet assigned. Rescue is split out because those
records describe sick animals by construction: blended in, they make the condition rate a measure
of how much rehabilitation data was loaded (2024: 13% with them, 4% without). BioNet's own API
separates acoustic, drone, licensed and public-app records; ALA's copy does not, so the rest of
BioNet stays together as one type.

**The merged corpus** (`ingestion/union/`) joins on `provenance.occurrenceId`, the same key the
console's cross-source comparison uses, and keeps the copy from the source the observation
originated at. It needs every record loaded, so each window's summary is computed once and stored
in `data/derived/union/`, naming the runs and classifier passes it was built from; a new run or
classifier pass is picked up the next time it is asked for. `npm run ingest -- union` builds them
all ahead of time (about two seconds for twelve years).

**The console** (`/console`) is for the researcher and the examiner: one run at a time, in
pipeline order, plus the two things that act. Raw data and Schema are scoped to the run selected
in the header strip; Harvest, Insights and AI analysis read across **every source fetched for the same
species, region and window** (the run's "family"), and the strip shows the scope and one chip per
source instead. `?harvest=…&run=…` selects a run on arrival, which is how the portal links in.

1. **Raw data** (`/console`) — every API call in the run, each response frozen verbatim and
   shown as read-only JSON with line numbers. Request metadata sits above it: status, size,
   timing, retry count, sha256, and the exact URL. A 100-record response is ~6,000 lines, so
   there is a whole-response / one-record toggle.
2. **Schema** (`/console/schema`) — the data as the database holds it, laid out like a table
   editor: one tab per table, one row per record, one column per field with its declared type in
   the header and `NULL` shown as `NULL`. `sightings` is the table the pipeline fills;
   `snapshot_pages` and `harvest_runs` are what its provenance columns point at, so the chain
   back to Raw data reads as foreign keys. A missing required value or a wrong type is tinted in
   the grid; fuzzed coordinates carry a `≈`; withheld text says so. Opening a row shows the
   record by schema group with both kinds of check kept distinct — **structural** (is the field
   present, is it the declared type) as per-field badges, **semantic** (is the date in the
   future, is the point inside Australia) in a panel above — and, per field, how the value got
   there: source field, raw value, and what the adapter did (`1736899200000 → 2025-01-15`).
   "Definition" swaps the grid for the Postgres DDL generated from the same schema declaration.
   Above the tables, "About this source" is a collapsed panel holding the selected run's own
   essentials: what was fetched and whether it all arrived (slices, reconciliation, hash),
   the datasets inside the source, its free-text bands and its quality flags.
3. **Harvest** (`/console/harvest`) — how each source's fetch went for the window: records
   retrieved against expected, completeness, datasets, obscuring, API calls and bytes frozen;
   and free text per field, per source and combined, in substance bands.
4. **Insights** (`/console/insights`) — what the sources say about each other, one question per
   card with a verdict and the evidence under it: how much of a primary source reaches the
   aggregator and why the rest does not, whether content survives the trip, whether coordinate
   obscuring survives the trip, whether there is enough text for an LLM, which datasets carry
   the text, how precisely each source locates sightings, whether each source's own flags
   discriminate anything. The comparison the portal's merge is built on. No model output.
5. **AI analysis** (`/console/analysis`) — where the analysis the portal shows is generated. The
   family's numbers are flattened into an *evidence pack* — a few hundred named metrics with ids,
   nothing per record, no text, no coordinates — and a frontier-tier model is asked what matters
   most to a practitioner and to state each insight's essence. The answer comes back through a
   tool schema citing metric ids, and the server checks it before storing it: every cited id
   must exist, and every number in the prose must be a value in the pack or a difference or
   ratio of two cited values. What fails is shown on the card as unverified, not hidden. One call
   per family, on a button press only, cached on disk with the evidence hash so a new run or a
   new classifier pass shows as "numbers have changed" rather than as a silently stale report.
6. **Run** (`/console/run`) — harvest a window from every source and watch it land.

The API is split the same way: `/api/portal/*` is GET only and always mounted;
`/api/console/corpus/*` and `/api/console/sync/*` carry everything run-scoped, raw or costly, and
are not mounted at all when `CONSOLE_ENABLED=false`. Set that for any deployment that is not
local, alongside `INGESTION_SERVE_RAW=false` and `INGESTION_ALLOW_UI_HARVEST=false`.

The schema itself is declared as data in `canonical/schema.ts`, not left implicit in the
TypeScript types, so the platform can render it, check records against it and version it —
Stage 1's stated output is the schema, so it should be a thing you can look at.

Precise coordinates and observer identifiers never leave the backend on any page but Raw data:
coordinates are reduced to ~1.1km and observer ids replaced with pseudonyms at the API boundary.

**Licensed content.** iNaturalist records are licensed per contributor, and 63% of its koala
observations are All Rights Reserved. Those are ingested, counted and analysed, but their text is
never served — `provenance.contentRedistributable` carries the answer and the API withholds the
words at the same boundary that fuzzes coordinates. The UI says a record's text is withheld rather
than rendering an empty field.

**Raw data is the deliberate exception.** A redacted "raw data" view would misrepresent what the
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
page), per record type on the portal's Sources page and Overview, and as cards on the console's
Insights page.

**Backfill.** Koala × NSW is defined one harvest per year from 2015 for both sources
(`config/harvests.ts`); `npm run ingest -- harvest koala-nsw-2024` fetches, freezes and adapts
one year. Backfill snapshot pages stay on disk and out of git; their manifests are tracked.
All twelve years of both sources were harvested complete on 11 Sep 2026 (about 250,000 ALA
records, 5,800 iNaturalist) and the keyword baseline has read every one of them.

## AI analysis

Generated from the console, shown in the portal. `ingestion/synthesis/` holds it: `evidence.ts` builds the pack from the family,
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
├── apis/         apiClient.ts (Axios, reads VITE_API_BASE_URL); corpusAPI/syncAPI (console),
│                 portalAPI (portal), and their types
├── layouts/      PortalLayout.vue, ConsoleLayout.vue — one per surface
├── views/        portal/ (Overview, Sources, AI analysis) and
│                 console/ (Raw data, Schema, Harvest, Insights, AI analysis, Run)
├── components/   corpus/ (console grids and panels), portal/ (year charts),
│                 shared/ (the AI analysis report both surfaces render)
├── stores/       corpusStore (console run selection), portalStore (portal window), syncStore
├── lib/          formatters, chart helpers, window labels, DDL generation
├── router/       "/" → portal routes, "/console" → console routes
└── App.vue       <RouterView />

backend/src/
├── index.ts      Hono app, CORS from ALLOWED_ORIGINS; mounts /api/portal, and /api/console/*
│                 when CONSOLE_ENABLED is not false
├── surfaces.ts   the CONSOLE_ENABLED flag
├── ingestion/    harvest, adapt, classify, synthesise; corpusService (by run) and
│                 portalService (by window, merged via union/) are the read layers
└── routes/       portal_routes.ts, corpus_routes.ts, sync_routes.ts, user_routes.ts (demo)
```

Note: `index.ts` imports routes with an explicit `.ts` extension. That works because the tsconfig
sets `allowImportingTsExtensions`, dev runs through `tsx`, and `rewriteRelativeImportExtensions`
rewrites those specifiers to `.js` on build.
