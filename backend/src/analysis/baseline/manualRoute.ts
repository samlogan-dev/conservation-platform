import { db } from "../../db/pool.ts";
import { INGESTION } from "../../ingestion/config/ingestion.ts";
import { monthBounds } from "../params.ts";

/**
 * The efficiency half of the evaluation: how much work the unaided route would take to reproduce
 * one calculated run's insights, against the platform producing them with no manual steps.
 *
 * The unaided route is a practitioner using ALA's own search and download, one taxon at a time —
 * what is available without building a database. It is a model, not a measurement: each step is
 * the fewest ALA queries, downloads, hand joins and calculations that step needs, and every unit
 * count comes from the corpus or the run itself, so the totals move with the data. The per-unit
 * figures are the assumptions; they are written out below and stored with the result.
 *
 *   query        one ALA search or facet request (a page of the website, or one API call)
 *   download     one records download (a CSV of a taxon's records for a window)
 *   join         combining two results by key by hand (taxon, region, cell or month)
 *   computation  one calculation on downloaded data (a threshold check, a grid count, a hull)
 *
 * Counts are lower bounds: no step is repeated after a mistake, and nothing is counted for
 * learning the method, for curating managed populations, or for the effort-group definitions.
 */
export const MANUAL_MODEL_VERSION = "2026-10-04.1";

export interface Step {
  insight: string;
  step: string;
  unit: string;
  units: number;
  perUnit: { queries?: number; downloads?: number; joins?: number; computations?: number };
}

type Totals = { queries: number; downloads: number; joins: number; computations: number };

export async function manualBaseline(calculatedRunId: string) {
  const q = async <T>(sql: string, args: unknown[] = []) => (await db().query<T & Record<string, unknown>>(sql, args)).rows;
  const [run] = await q<{ params: any; seconds: number }>(
    `select params, extract(epoch from finished_at - started_at)::float as seconds from analysis.runs
     where run_id = $1 and arm = 'calculated' and status = 'done'`,
    [calculatedRunId],
  );
  if (!run) throw new Error(`no completed calculated run ${calculatedRunId}`);
  const p = run.params;
  const report = monthBounds(p.reportMonth);
  const windowMonths = (w: { start: string; end: string }) => {
    const [ys, ms] = w.start.split("-").map(Number) as [number, number];
    const [ye, me] = w.end.split("-").map(Number) as [number, number];
    return (ye - ys) * 12 + (me - ms) + 1;
  };
  const months = windowMonths(p.rangeChange.baselineWindow) + windowMonths(p.rangeChange.recentWindow);

  const counts = async (type: string, national: boolean | null) =>
    Number(
      (await q<{ n: string }>(
        `select count(*) as n from analysis.insights where run_id = $1 and insight_type = $2
           and ($3::boolean is null or (region is null) = $3)`,
        [calculatedRunId, type, national],
      ))[0]!.n,
    );
  const [[taxa], [baselineTaxa], [reportTaxa]] = await Promise.all([
    q<{ n: number }>("select count(*)::int as n from corpus.taxa"),
    // Taxa with any baseline record in a region: each needs its regions checked for silence.
    q<{ n: number }>(
      `select count(distinct taxon_concept_id)::int as n from corpus.analysable_occurrences
       where event_day between $1::date and $2::date and ibra_region is not null`,
      [p.baseline.start, p.baseline.end],
    ),
    // Statistical-tier taxa recorded in the report month: each is checked for notable records.
    q<{ n: number }>(
      `select count(distinct a.taxon_concept_id)::int as n from corpus.analysable_occurrences a
       join corpus.taxon_tiers t using (taxon_concept_id)
       where t.statistical_tier and a.event_day between $1::date and $2::date`,
      [report.start, report.end],
    ),
  ]);
  const [rangeTaxa, rateTaxa, ratePairs, regions] = await Promise.all([
    counts("range_change", true),
    counts("reporting_rate", true),
    counts("reporting_rate", false),
    counts("co_movement", null),
  ]);
  const groups = 6; // the effort groups: all, birds, mammals, reptiles, amphibians, plants

  const steps: Step[] = [
    { insight: "1", step: "Last record and records since 2015, per listed taxon (a search sorted by date)", unit: "listed taxa", units: taxa.n,
      perUnit: { queries: 1, computations: 1 } },
    { insight: "1", step: "Records per bioregion in the baseline and in the last 36 months, matched to find regions gone quiet", unit: "taxa with baseline records in a bioregion", units: baselineTaxa.n,
      perUnit: { queries: 2, joins: 1, computations: 1 } },
    { insight: "2", step: "Download each window's records, set aside managed populations, count occupied 2 km and 10 km cells and the hull, per window", unit: "taxa with records in both windows", units: rangeTaxa,
      perUnit: { downloads: 2, joins: 1, computations: 6 } },
    { insight: "2", step: "Records per dataset in each window, to find sources that stopped recording the taxon", unit: "taxa assessed for range", units: rangeTaxa,
      perUnit: { queries: 2, joins: 1, computations: 1 } },
    { insight: "3", step: `Group recording per 0.1° cell per month (${groups} groups × ${months} months), shared by every taxon`, unit: "report", units: 1,
      perUnit: { queries: groups * months } },
    { insight: "3", step: `Detections per 0.1° cell per month for the taxon (${months} months), joined month by month to its group's recording over its footprint`, unit: "taxa considered for reporting rate", units: rateTaxa,
      perUnit: { queries: months, joins: months } },
    { insight: "3", step: "Datasets recording the taxon in both windows (consistent sources), then the ratio and its interval", unit: "taxa considered for reporting rate", units: rateTaxa,
      perUnit: { queries: 2, joins: 1, computations: 1 } },
    { insight: "3", step: "Cells assigned to bioregions and the ratio recomputed per taxon and bioregion", unit: "taxon–bioregion pairs", units: ratePairs,
      perUnit: { joins: 1, computations: 1 } },
    { insight: "4", step: "Per bioregion, count declines and increases and test against the national share; then the false-discovery adjustment", unit: "bioregions assessed", units: regions,
      perUnit: { computations: 1 } },
    { insight: "5", step: "Report-month records, all earlier records, earlier bioregions and baseline months per taxon; distance, new-region and season checks", unit: "tier taxa recorded in the report month", units: reportTaxa.n,
      perUnit: { queries: 3, downloads: 1, computations: 3 } },
  ];

  const zero = (): Totals => ({ queries: 0, downloads: 0, joins: 0, computations: 0 });
  const byInsight: Record<string, Totals> = {};
  const total = zero();
  for (const s of steps) {
    const t = (byInsight[s.insight] ??= zero());
    for (const k of Object.keys(total) as (keyof Totals)[]) {
      const n = (s.perUnit[k] ?? 0) * s.units;
      t[k] += n;
      total[k] += n;
    }
  }
  // Even scripted, ALA requests at the polite interval set a floor under the query count alone.
  const requestFloorHours = ((total.queries + total.downloads) * INGESTION.minRequestIntervalMs) / 3_600_000;

  const ai = await q<{ brief: string; runs: number; mean_cost: number; mean_minutes: number; mean_turns: number; mean_queries: number; mean_output_tokens: number }>(
    `select r.brief, count(*)::int as runs,
            avg((r.usage->>'estimatedCostUsd')::float) as mean_cost,
            avg(extract(epoch from r.finished_at - r.started_at) / 60)::float as mean_minutes,
            avg((r.usage->>'turns')::float) as mean_turns,
            avg((r.usage->>'queries')::float) as mean_queries,
            avg((r.usage->>'outputTokens')::float) as mean_output_tokens
     from analysis.runs r
     where r.arm = 'ai' and r.status = 'done'
       -- Runs made against this corpus state, not earlier runs re-scored against it.
       and r.started_at > (select finished_at from analysis.runs where run_id = $1)
       and exists (select 1 from analysis.comparisons c where c.ai_run_id = r.run_id and c.calculated_run_id = $1)
     group by r.brief order by r.brief`,
    [calculatedRunId],
  );
  const platform = {
    manual_steps: 0,
    calculated_arm_seconds: Math.round(run.seconds),
    ai_arm: ai,
  };
  const totals = { ...total, by_insight: byInsight, ala_request_floor_hours: Math.round(requestFloorHours * 10) / 10 };

  const [row] = await q<{ baseline_id: number }>(
    `insert into analysis.manual_baselines (calculated_run_id, model_version, steps, totals, platform)
     values ($1, $2, $3, $4, $5) returning baseline_id::int`,
    [calculatedRunId, MANUAL_MODEL_VERSION, JSON.stringify(steps), JSON.stringify(totals), JSON.stringify(platform)],
  );
  return { baselineId: row!.baseline_id, steps, totals, platform };
}
