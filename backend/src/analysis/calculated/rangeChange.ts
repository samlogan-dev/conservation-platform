import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as P } from "../params.ts";
import { type Insight, taxonLabel } from "../runs.ts";

/**
 * Insight #2 — range change, statistical tier only, baseline window against recent window.
 *
 * Three measures (decided 3 Oct 2026), because ALA generalises sensitive species' locations —
 * 17% of analysable records sit at 2–10 km uncertainty, 31% state none:
 *  - EOO, the minimum convex polygon of every record: barely moved by ~10 km blurring;
 *  - AOO at 2 km (IUCN criterion B grid), from records located to within 2 km only — marked
 *    unreliable when too few records in either window are that precise;
 *  - AOO at 10 km, from every record: the measure the flag is raised on.
 * Grids are in EPSG:3577 (Australian Albers, equal-area).
 *
 * One insight per taxon, flagged or not, so the AI arm's figures can be checked against any
 * taxon it reports on. `figures.flag` is "contraction", "expansion" or null.
 *
 * Every range metric grows with sampling effort, so two effort diagnostics ride along in
 * `confidence`:
 *  - the national all-taxa effort ratio between the windows — a contraction while effort rose is
 *    the stronger signal;
 *  - the share of the taxon's baseline records from datasets that no longer record *this taxon*
 *    in the recent window. A source that stopped (a compilation ending in 2020, a targeted survey
 *    wound up inside an ongoing state atlas) looks exactly like range loss. Found on the first run:
 *    Pacific Ridley's "contraction" was one compilation ending; a dataset-level version of this
 *    measure missed most such cases, because the atlases themselves carry on.
 */
export async function rangeChange(): Promise<Insight[]> {
  const R = P.rangeChange;
  const { rows } = await db().query<{
    taxon_concept_id: string; scientific_name: string | null; vernacular_name: string | null;
    national_status: string | null; win: "baseline" | "recent"; records: number; precise_records: number;
    eoo_km2: number; aoo_fine_cells: number; aoo_coarse_cells: number; datasets: number; share_managed: number;
    share_discontinued: number;
  }>(
    `with w as (
       select a.taxon_concept_id, a.geom, a.coordinate_uncertainty_m, a.data_resource_uid, a.dataset_kind,
              case when a.event_date >= $1::date and a.event_date < $2::date + 1 then 'baseline'
                   when a.event_date >= $3::date and a.event_date < $4::date + 1 then 'recent' end as win
       from corpus.analysable_occurrences a
       join corpus.taxon_tiers tt using (taxon_concept_id)
       where tt.statistical_tier and a.geom is not null
         and ((a.event_date >= $1::date and a.event_date < $2::date + 1)
           or (a.event_date >= $3::date and a.event_date < $4::date + 1))
     ), active_recent as (
       select distinct taxon_concept_id, data_resource_uid from w where win = 'recent'
     ), p as (
       select w.*, st_transform(w.geom, 3577) as albers,
              coalesce(w.coordinate_uncertainty_m <= $5, false) as precise,
              (ar.data_resource_uid is null) as from_discontinued
       from w left join active_recent ar using (taxon_concept_id, data_resource_uid)
     )
     select p.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status, p.win,
            count(*)::int as records,
            count(*) filter (where precise)::int as precise_records,
            (st_area(st_convexhull(st_collect(p.geom))::geography) / 1e6)::float as eoo_km2,
            count(distinct (floor(st_x(albers) / $5), floor(st_y(albers) / $5))) filter (where precise)::int as aoo_fine_cells,
            count(distinct (floor(st_x(albers) / $6), floor(st_y(albers) / $6)))::int as aoo_coarse_cells,
            count(distinct p.data_resource_uid)::int as datasets,
            avg((p.dataset_kind = 'managed')::int)::float as share_managed,
            avg(p.from_discontinued::int)::float as share_discontinued
     from p join corpus.taxa t using (taxon_concept_id)
     group by p.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status, p.win`,
    [R.baselineWindow.start, R.baselineWindow.end, R.recentWindow.start, R.recentWindow.end, R.aooFineCellM, R.aooCoarseCellM],
  );

  // National all-taxa effort per window, per year — what the range measures are read against.
  const effort = await db().query<{ win: string; records: string }>(
    `select case when period_start >= $1::date and period_end <= $2::date then 'baseline' else 'recent' end as win,
            sum(records) as records
     from corpus.effort_cells
     where (period_start >= $1::date and period_end <= $2::date) or (period_start >= $3::date and period_end <= $4::date)
     group by 1`,
    [R.baselineWindow.start, R.baselineWindow.end, R.recentWindow.start, R.recentWindow.end],
  );
  const effortOf = (w: string) => Number(effort.rows.find((r) => r.win === w)?.records ?? 0);
  const effortRatio = effortOf("baseline") > 0 ? effortOf("recent") / effortOf("baseline") : null;

  const byTaxon = new Map<string, { base?: (typeof rows)[number]; recent?: (typeof rows)[number] }>();
  for (const r of rows) {
    const e = byTaxon.get(r.taxon_concept_id) ?? {};
    if (r.win === "baseline") e.base = r;
    else e.recent = r;
    byTaxon.set(r.taxon_concept_id, e);
  }

  const change = (before: number, after: number): number | null =>
    before > 0 ? Number(((after - before) / before).toFixed(3)) : null;
  const pct = (x: number | null) => (x === null ? "n/a" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);

  const insights: Insight[] = [];
  for (const [taxonConceptId, { base, recent }] of byTaxon) {
    const any = (base ?? recent)!;
    const b = { records: base?.records ?? 0, precise: base?.precise_records ?? 0, eoo: base?.eoo_km2 ?? 0, fine: base?.aoo_fine_cells ?? 0, coarse: base?.aoo_coarse_cells ?? 0 };
    const n = { records: recent?.records ?? 0, precise: recent?.precise_records ?? 0, eoo: recent?.eoo_km2 ?? 0, fine: recent?.aoo_fine_cells ?? 0, coarse: recent?.aoo_coarse_cells ?? 0 };
    const coarseChange = change(b.coarse, n.coarse);
    const enough = b.records >= R.minRecordsPerWindow && n.records >= R.minRecordsPerWindow;
    const flag =
      enough && coarseChange !== null && coarseChange <= -R.flagChange ? "contraction"
      : enough && coarseChange !== null && coarseChange >= R.flagChange ? "expansion"
      : null;
    const fineReliable =
      b.records > 0 && n.records > 0 &&
      b.precise / b.records >= R.minPreciseShareForFineAoo && n.precise / n.records >= R.minPreciseShareForFineAoo;
    const name = taxonLabel(any.vernacular_name, any.scientific_name);

    insights.push({
      insightType: "range_change",
      taxonConceptId,
      region: null,
      periodStart: R.recentWindow.start,
      periodEnd: R.recentWindow.end,
      figures: {
        flag,
        national_status: any.national_status,
        baseline_window: R.baselineWindow,
        aoo_10km_km2: { baseline: b.coarse * 100, recent: n.coarse * 100, change: coarseChange },
        aoo_2km_km2: { baseline: b.fine * 4, recent: n.fine * 4, change: change(b.fine, n.fine), reliable: fineReliable },
        eoo_km2: { baseline: Math.round(b.eoo), recent: Math.round(n.eoo), change: change(b.eoo, n.eoo) },
        records: { baseline: b.records, recent: n.records },
      },
      confidence: {
        enough_records: enough,
        precise_share: {
          baseline: b.records ? Number((b.precise / b.records).toFixed(3)) : null,
          recent: n.records ? Number((n.precise / n.records).toFixed(3)) : null,
        },
        national_effort_ratio: effortRatio === null ? null : Number(effortRatio.toFixed(3)),
        baseline_share_from_sources_no_longer_recording: base ? Number(base.share_discontinued.toFixed(3)) : null,
        datasets: Math.max(base?.datasets ?? 0, recent?.datasets ?? 0),
        share_managed: Number((recent?.share_managed ?? base?.share_managed ?? 0).toFixed(3)),
      },
      summary:
        `${name}: area of occupancy (10 km grid) ${pct(coarseChange)} between ` +
        `${R.baselineWindow.start.slice(0, 4)}–${R.baselineWindow.end.slice(0, 4)} and ` +
        `${R.recentWindow.start.slice(0, 4)}–${R.recentWindow.end.slice(0, 4)} ` +
        `(${b.coarse * 100} → ${n.coarse * 100} km²; extent of occurrence ${pct(change(b.eoo, n.eoo))}; ` +
        `${b.records} → ${n.records} records)` +
        (flag ? ` — flagged as ${flag}.` : enough ? "." : " — too few records to flag."),
    });
  }
  return insights;
}
