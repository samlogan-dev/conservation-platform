import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as C, monthBounds } from "../params.ts";
import { QUERY_LIMITS } from "./queryTool.ts";

/**
 * The AI arm's prompts and tools — research methodology, so versioned: change any text here and
 * bump PROMPT_VERSION. The version is written into every run (analysis.runs.prompt_version).
 *
 * Two briefs share one system prompt:
 *  - guided: the insights the calculated arm computes, defined exactly (windows and thresholds are
 *    generated from CALCULATED_PARAMS, so the two arms cannot drift apart) — a reproduction test;
 *  - open: what a practitioner should know, with no mention of the insights and no insight-type
 *    field in its recording tool, so neither the prompt nor the tool schema hints at what the
 *    calculated arm looks for — a discovery test.
 */
export const PROMPT_VERSION = "ai-2026-10-04.3";
// ai-2026-10-04.3: effort_cells has a taxon_group; the guided brief adds insight #3,
// reporting_rate.
// ai-2026-10-04.2: the schema lists only columns ai_reader may read (free-text remarks withheld,
// db/migrations/014).
// ai-2026-10-04.1, after the pilot runs: dates stated as event_day (Australian Eastern local
// date); population ('wild' | 'managed', set per taxon and state as well as per dataset) replaces
// dataset_kind as the managed marker; related_taxa lets one insight name several taxa; the guided
// brief fixes notable-record reason labels and range change on wild records.

export type Brief = "guided" | "open";

/** Hand-written meaning for each corpus relation; columns come from the live catalogue. */
const RELATION_NOTES: Record<string, string> = {
  analysable_occurrences:
    "VIEW — the records to analyse: occurrences that are valid, dated, and not from telemetry (animal-tracking) datasets. Includes population ('wild' or 'managed' — managed means a fenced haven, reintroduction or other managed population, set from the dataset or from corpus.managed_populations) and dataset_kind (the dataset's own kind). Prefer this over occurrences.",
  occurrences:
    "TABLE — every canonical occurrence record, telemetry included. event_date is the observation instant (timestamptz); event_day is its Australian Eastern local date. geom is a PostGIS Point (SRID 4326); cell_lat/cell_lon are the 0.1° grid cell (rounded to nearest, as ALA assigns them).",
  managed_populations:
    "TABLE — curated rules marking managed populations: a taxon in a state (optionally narrowed to an IBRA region and a dataset), e.g. Bilby in NSW, where it survives only in fenced havens, or Woylie in AWC's Mt Gibson haven. Already applied in analysable_occurrences.population.",
  taxa: "TABLE — one row per taxon (key taxon_concept_id); national_status is the EPBC status ALA attached.",
  taxon_tiers:
    `VIEW — per taxon: analysable records since 2015, last_record_day, and statistical_tier (≥${C.statisticalTierMinRecords} records since 2015).`,
  datasets: "TABLE — contributing datasets; kind is 'wild', 'managed' (fenced havens, reintroductions) or 'telemetry' (excluded from analysable_occurrences).",
  effort_cells:
    "TABLE — record counts (threatened or not, telemetry excluded) per 0.1° cell per month, per taxon_group: 'all' (every taxon), or 'Aves', 'Mammalia', 'Reptilia', 'Amphibia', 'Plantae' (that group only). The denominator for reporting rates. Join on cell_lat/cell_lon and month, and always filter taxon_group — summing across groups double-counts.",
  harvest_runs: "TABLE — provenance of each harvest (the corpus download and the effort counts).",
};

async function schemaDescription(): Promise<string> {
  const { rows } = await db().query<{ table_name: string; columns: string }>(
    `select table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as columns
     from information_schema.columns
     where table_schema = 'corpus'
       and has_column_privilege('ai_reader', format('corpus.%I', table_name), column_name, 'SELECT')
     group by table_name order by table_name`,
  );
  return rows
    .map((r) => `corpus.${r.table_name} — ${RELATION_NOTES[r.table_name] ?? ""}\n  columns: ${r.columns}`)
    .join("\n\n");
}

export async function systemPrompt(): Promise<string> {
  const { end } = monthBounds(C.reportMonth);
  return `You are the analysis agent of a reporting platform for Australia's threatened species. Conservation practitioners — people in government agencies, NGOs and recovery teams who decide where to survey, what to protect and what to escalate — read what you produce. You have read-only SQL access to the platform's database and produce insights from it, each grounded in queries you ran.

# The data

PostgreSQL 17 with PostGIS 3.5. The corpus is every occurrence record the Atlas of Living Australia (ALA) tags as nationally threatened (EPBC Critically Endangered, Endangered or Vulnerable), observed January 2015 to ${end}, from one bulk download (DOI 10.26197/ala.40eee344-07ce-48d2-9ec2-be39574ff4c7): about 2.1 million records, 1,850 taxa, 300+ contributing datasets. Alongside it are all-taxa effort counts per 0.1° cell per month for the same period.

${await schemaDescription()}

Useful facts: EPSG:3577 (Australian Albers, equal-area, metres) is available for gridding and areas; ibra_region is the IBRA 7 bioregion (null offshore — IBRA covers land only); coordinate_uncertainty_m is the radius the true position may lie within.

**Dates: use event_day** (the Australian Eastern local date) for every date window, count by period and date you report — not event_date, which is an instant stored in UTC and would put early-morning Australian records on the previous day.

# Known properties of this data — read before interpreting anything

- **Records measure effort as much as animals.** These are mostly opportunistic records. All-taxa recording roughly doubled between 2017–19 and 2022–24 (about 1.9×), so counts and range measures grow with effort. Use corpus.effort_cells as a denominator where it matters.
- **Recent months are incomplete.** Datasets reach ALA months to a year late: January–August 2026 holds about 20% of the records January–August 2024 holds, and eBird (the largest dataset) has not loaded 2026 at all. A recent decline is not evidence of anything until this is accounted for.
- **Sources start and stop.** A compilation that ends in 2020, or a targeted survey wound up inside an ongoing state atlas, looks exactly like range loss. Check which datasets carry a taxon's records in each period before calling a change real.
- **Locations vary in precision.** About half the analysable records are located to within 2 km; about a third state no uncertainty; ALA generalises many sensitive species to roughly 10 km.
- **Managed populations** (population = 'managed': fenced havens, reintroductions) are in the analysable view and are not wild trend.
- **National status** is as ALA attached it. Never infer, change or second-guess a taxon's conservation status.
- Taxonomy can shift: a taxon "disappearing" from a region can be a name re-assignment.

# How to work

- Call run_sql with one SELECT (or WITH … SELECT) per call, no trailing statements. Results are capped at ${QUERY_LIMITS.maxRows} rows and queries time out after ${QUERY_LIMITS.statementTimeoutMs / 1000} s, so aggregate in SQL rather than pulling rows. Each call returns a query_id.
- Record each insight with record_insight as soon as it is established. Every insight cites the query_ids whose results support it, and every number in it must be a value those queries returned or simple arithmetic on them. Do not state figures you did not query.
- taxon_concept_id must be copied exactly from corpus.taxa; when an insight is about several taxa, put the main one there (or null) and list the others in related_taxa; region is an IBRA region name exactly as in ibra_region, or null for a national insight; period_start and period_end are the window the insight describes.
- Say how confident you are and why, in the confidence field: record counts, the datasets involved, effort, precision, and any artefact that could explain the pattern.
- When you have recorded everything worth recording, stop.`;
}

export function briefText(brief: Brief): string {
  const { start: mStart, end: mEnd } = monthBounds(C.reportMonth);
  const S = C.silentSpecies;
  const R = C.rangeChange;
  const N = C.notableRecords;
  const RR = C.reportingRate;
  const lookbackStart = (() => {
    const d = new Date(`${mEnd}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - S.lookbackMonths);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const yrs = (w: { start: string; end: string }) => `${w.start.slice(0, 4)}–${w.end.slice(0, 4)}`;

  if (brief === "open") {
    return `It is October 2026. A conservation practitioner responsible for Australia's threatened species asks: from this data, what should I know right now — what has changed, what is concerning, what is new, and where are we blind?

Investigate as you judge best and record each insight worth their attention — aim for the most important 20 to 40. For each, be explicit about confidence and about any data artefact that could explain the pattern.`;
  }

  return `Report month: ${C.reportMonth} (${mStart} to ${mEnd}). Compute the four insights below exactly as defined and record them with record_insight, using the insight_type given. "Analysable" means corpus.analysable_occurrences. The statistical tier is taxa with statistical_tier = true in corpus.taxon_tiers.

## 1. silent_species — period ${lookbackStart} to ${mEnd}
(a) Silent: taxa in corpus.taxa with no analysable record in that window (whatever their record count).
(b) Evidence gap: taxa with fewer than ${S.evidenceGapMaxRecords} analysable records since 2015.
(c) Regional silence: a taxon and IBRA region where the taxon had at least ${S.regionalMinBaselineRecords} analysable records in ${yrs(C.baseline)} but none in the window, while the taxon was still recorded nationally in the window.
Record one headline insight per kind (taxon and region null; figures {kind: "silent" | "evidence_gap" | "regional_silence", count}), then individual insights for the most important cases, up to 15 per kind (figures {kind, last_record_date, records_since_2015, …}, last_record_date as event_day; regional ones with region set).

## 2. range_change — statistical tier, ${yrs(R.baselineWindow)} against ${yrs(R.recentWindow)} (period ${R.recentWindow.start} to ${R.recentWindow.end})
Per taxon and window, from analysable records with coordinates:
Wild records only (population = 'wild').
- AOO 10 km: distinct ${R.aooCoarseCellM / 1000} km cells on an EPSG:3577 grid, all records; area = cells × ${(R.aooCoarseCellM / 1000) ** 2} km².
- AOO 2 km: distinct ${R.aooFineCellM / 1000} km cells, only records with coordinate_uncertainty_m ≤ ${R.aooFineCellM}; area = cells × ${(R.aooFineCellM / 1000) ** 2} km².
- EOO: area of the convex hull of all records, km².
Flag "contraction" or "expansion" when the 10 km AOO changes by at least ${R.flagChange * 100}% and both windows have at least ${R.minRecordsPerWindow} records.
Record headline insights with the count of contractions and of expansions (figures {flag, count}), then individual insights for the most important flagged taxa, up to 15 (figures {flag, aoo_10km_km2: {baseline, recent, change}, aoo_2km_km2: {baseline, recent, change}, eoo_km2: {baseline, recent, change}, records: {baseline, recent}}, change as a fraction).

## 3. notable_record — records in ${C.reportMonth} of statistical-tier taxa
A record is notable if it is more than ${N.outsideRangeKm} km from every earlier analysable record of the taxon (since 2015), or in an IBRA region with no earlier record of the taxon, or in a calendar month holding less than ${N.outOfSeasonMaxShare * 100}% of the taxon's ${yrs(C.baseline)} records (judged only where the taxon has at least ${N.seasonMinBaselineRecords} such records). Group by taxon and IBRA region: one insight per group, up to 30 (figures {reasons: [...], records, max_distance_to_prior_km}, reasons drawn from "outside_range", "new_region", "out_of_season").

## 4. reporting_rate — statistical tier, ${yrs(R.baselineWindow)} against ${yrs(R.recentWindow)} (period ${R.recentWindow.start} to ${R.recentWindow.end})
Wild analysable records with a grid cell (cell_lat not null), per taxon, nationally and per IBRA region.
- Effort group: 'Plantae' if the taxon's kingdom is Plantae; its taxon_class if Aves, Mammalia, Reptilia or Amphibia; otherwise 'all'.
- Footprint: the 0.1° cells where the taxon (in that region, for a regional figure) has a record in either window.
- Consistent sources: datasets that recorded the taxon (in that scope) in both windows. Both numerators below count only their records.
- Detection ratio (the flag): per window, detections = distinct (cell, month of event_day) in the footprint with a consistent-source record; visits = footprint cell-months with effort_cells records > 0 for the effort group; rate = detections ÷ visits; ratio = recent rate ÷ baseline rate. 95% interval: ratio × exp(±${RR.z} × √(1/d_baseline − 1/v_baseline + 1/d_recent − 1/v_recent)).
- Record ratio: per window, consistent-source records ÷ effort-group records summed over the footprint cells and the window's months; ratio = recent ÷ baseline.
Flag "decline" when the detection ratio is ≤ ${RR.declineRatio}, its interval's upper end is below 1 and the record ratio is below 1; "increase" when the detection ratio is ≥ ${RR.increaseRatio.toFixed(4)}, its interval's lower end is above 1 and the record ratio is above 1; both need at least ${RR.minDetectionsPerWindow} detections in each window. Regional figures only for taxon–region pairs with at least ${RR.minRecordsPerWindow} records (all sources) in each window.
Record national headline insights with the count of declines and of increases (taxon and region null; figures {flag, count}), then individual insights for the most important flagged taxa, nationally and by region, up to 15 each (figures {flag, effort_group, detections: {baseline, recent}, visits: {baseline, recent}, detection_ratio, detection_ratio_ci95: [low, high], consistent_source_ratio}).

Beyond these, record anything else a practitioner should know as insight_type "other".`;
}

const QUERY_TOOL: Anthropic.Tool = {
  name: "run_sql",
  description:
    "Run one read-only SQL query (a single SELECT or WITH … SELECT) against the corpus. Returns a query_id, the columns and up to " +
    `${QUERY_LIMITS.maxRows} rows. Cite the query_id in any insight that relies on the result.`,
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "One SELECT or WITH … SELECT statement." },
      purpose: { type: "string", description: "One line: what this query is for." },
    },
    required: ["sql", "purpose"],
  },
};

const INSIGHT_PROPERTIES = {
  taxon_concept_id: { type: ["string", "null"], description: "Exactly as in corpus.taxa, or null for a non-taxon insight." },
  related_taxa: { type: "array", items: { type: "string" }, description: "Optional: other taxon_concept_ids this insight is about, exactly as in corpus.taxa." },
  region: { type: ["string", "null"], description: "IBRA region name exactly as in ibra_region, or null for national." },
  period_start: { type: "string", description: "YYYY-MM-DD — start of the window the insight describes." },
  period_end: { type: "string", description: "YYYY-MM-DD — end of that window." },
  figures: { type: "object", description: "The numbers behind the insight, as returned by your queries." },
  confidence: { type: "object", description: "Why this should or should not be trusted: records, datasets, effort, precision, possible artefacts." },
  summary: { type: "string", description: "One or two sentences a practitioner can act on." },
  query_ids: { type: "array", items: { type: "integer" }, description: "The run_sql query_ids whose results support this insight." },
} as const;

export function tools(brief: Brief): Anthropic.Tool[] {
  const record: Anthropic.Tool =
    brief === "guided"
      ? {
          name: "record_insight",
          description: "Record one insight. Every figure must come from the cited queries.",
          input_schema: {
            type: "object",
            properties: {
              insight_type: {
                type: "string",
                enum: ["silent_species", "range_change", "reporting_rate", "notable_record", "other"],
              },
              ...INSIGHT_PROPERTIES,
            },
            required: ["insight_type", "taxon_concept_id", "region", "period_start", "period_end", "figures", "confidence", "summary", "query_ids"],
          },
        }
      : {
          name: "record_insight",
          description: "Record one insight. Every figure must come from the cited queries.",
          input_schema: {
            type: "object",
            properties: {
              category: { type: "string", description: "A short label of your own for the kind of insight." },
              ...INSIGHT_PROPERTIES,
            },
            required: ["category", "taxon_concept_id", "region", "period_start", "period_end", "figures", "confidence", "summary", "query_ids"],
          },
        };
  return [QUERY_TOOL, record];
}
