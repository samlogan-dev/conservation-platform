import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as P } from "../params.ts";
import { type Insight, taxonLabel } from "../runs.ts";

/**
 * Insight #3 — reporting-rate trend: is a taxon recorded less often relative to how much recording
 * happens where it lives? The nearest occurrence data gets to "is it declining" — a reporting
 * rate, never a population count.
 *
 * Two measures, both over the taxon's footprint (the 0.1° cells where it was recorded in either
 * window) and against the effort of its own taxonomic group (corpus.effort_cells):
 *
 *   detection rate = cell-months with a record of the taxon ÷ cell-months with any record of its
 *                    group — the textbook reporting rate, a "visit" being a cell-month. THE FLAG.
 *   record rate    = taxon records ÷ group records.
 *
 * Why the flag is on detections: one targeted survey can lodge thousands of records in a single
 * cell-month (every plant counted) and then stop inside an ongoing atlas — Newcastle Doubletail
 * went 3,205 → 39 records with plant effort flat, a −99% record rate, while its detection rate
 * held (0.99). Counting each cell-month once removes that artefact. Detections drift slightly the
 * other way for intensively watched groups (more effort per visit raises the chance of a
 * detection), so a flag also needs the record rate to move in the same direction.
 *
 * Both restrictions keep the denominator to effort that could have found the taxon. The group:
 * birds are ~76% of all ALA records, so an all-taxa denominator is a bird index, and every
 * threatened plant's rate fell as birdwatching and iNaturalist grew (median ratio 0.68 for plants
 * against 0.91 for birds on the first, all-taxa version). Groups: Aves, Mammalia, Reptilia,
 * Amphibia, Plantae; any other taxon (fish, insects, …) falls back to all taxa, stated in its
 * figures. The footprint: national effort would drown a coastal bird in inland recording.
 *
 * Both numerators count only **consistent sources** — datasets that recorded the taxon in both
 * windows. A dataset that ended (Victorian atlas programmes, Pacific Ridley's compilation)
 * otherwise reads as a steep decline — the artefact the open-brief AI runs kept warning about.
 * The all-source record ratio is reported beside them.
 *
 * A flag needs the 95% interval of the detection ratio to exclude 1 (ratio of two binomial
 * proportions: log-ratio standard error √(1/d_b − 1/v_b + 1/d_r − 1/v_r)), and at least
 * minDetectionsPerWindow detections in each window. The record ratio's interval treats records as
 * Poisson counts against a fixed denominator, √(1/n_b + 1/n_r), and is reported only.
 *
 * Scope: one national insight per statistical-tier taxon (flagged or not, so any AI figure can be
 * checked), plus one per taxon and IBRA region with enough records in both windows — the input to
 * insight #4. A 0.1° cell straddling two regions counts its full effort in each; stated, minor.
 */
interface Row {
  taxon_concept_id: string; region: string; scientific_name: string | null; vernacular_name: string | null;
  national_status: string | null; nb: number; nr: number; nbc: number; nrc: number;
  datasets: number; consistent_datasets: number; cells: number; effort_group: string; eb: string; er: string;
  db: number; dr: number; vb: string; vr: string;
}

function query(regional: boolean): string {
  const scope = regional ? "a.ibra_region" : "''::text";
  return `with w as (
       select a.taxon_concept_id, ${scope} as region, a.cell_lat, a.cell_lon, a.data_resource_uid, g.effort_group,
              date_trunc('month', a.event_day)::date as month,
              case when a.event_day >= $1::date and a.event_day <= $2::date then 'b' else 'r' end as win
       from corpus.analysable_occurrences a
       join corpus.taxon_tiers tt using (taxon_concept_id)
       join (select taxon_concept_id,
                    case when kingdom = 'Plantae' then 'Plantae'
                         when taxon_class in ('Aves', 'Mammalia', 'Reptilia', 'Amphibia') then taxon_class
                         else 'all' end as effort_group
             from corpus.taxa) g using (taxon_concept_id)
       where tt.statistical_tier and a.cell_lat is not null
         and (not $5::boolean or a.population = 'wild')
         and ((a.event_day >= $1::date and a.event_day <= $2::date) or (a.event_day >= $3::date and a.event_day <= $4::date))
         ${regional ? "and a.ibra_region is not null" : ""}
     ), both_windows as (
       select taxon_concept_id, region, data_resource_uid from w
       group by 1, 2, 3 having count(distinct win) = 2
     ), counts as (
       select w.taxon_concept_id, w.region,
              count(*) filter (where w.win = 'b')::int as nb,
              count(*) filter (where w.win = 'r')::int as nr,
              count(*) filter (where w.win = 'b' and s.data_resource_uid is not null)::int as nbc,
              count(*) filter (where w.win = 'r' and s.data_resource_uid is not null)::int as nrc,
              count(distinct w.data_resource_uid)::int as datasets,
              count(distinct s.data_resource_uid)::int as consistent_datasets,
              count(distinct (w.cell_lat, w.cell_lon))::int as cells,
              count(distinct (w.cell_lat, w.cell_lon, w.month)) filter (where w.win = 'b' and s.data_resource_uid is not null)::int as db,
              count(distinct (w.cell_lat, w.cell_lon, w.month)) filter (where w.win = 'r' and s.data_resource_uid is not null)::int as dr
       from w left join both_windows s using (taxon_concept_id, region, data_resource_uid)
       group by 1, 2
     ), footprint as (
       select distinct taxon_concept_id, region, effort_group, cell_lat, cell_lon from w
     ), effort as (
       select taxon_group as effort_group, cell_lat, cell_lon,
              sum(records) filter (where period_start >= $1::date and period_start <= $2::date) as eb,
              sum(records) filter (where period_start >= $3::date and period_start <= $4::date) as er,
              count(*) filter (where records > 0 and period_start >= $1::date and period_start <= $2::date) as vb,
              count(*) filter (where records > 0 and period_start >= $3::date and period_start <= $4::date) as vr
       from corpus.effort_cells
       where period_start >= $1::date and period_start <= $4::date
       group by 1, 2, 3
     ), footprint_effort as (
       select f.taxon_concept_id, f.region, f.effort_group, sum(coalesce(e.eb, 0)) as eb, sum(coalesce(e.er, 0)) as er,
              sum(coalesce(e.vb, 0)) as vb, sum(coalesce(e.vr, 0)) as vr
       from footprint f left join effort e using (effort_group, cell_lat, cell_lon)
       group by 1, 2, 3
     )
     select c.*, fe.effort_group, fe.eb, fe.er, fe.vb, fe.vr, t.scientific_name, t.vernacular_name, t.national_status
     from counts c
     join footprint_effort fe using (taxon_concept_id, region)
     join corpus.taxa t using (taxon_concept_id)
     ${regional ? "where c.nb >= $6 and c.nr >= $6" : ""}`;
}

export async function reportingRate(): Promise<Insight[]> {
  const R = P.reportingRate;
  const W = { b: P.rangeChange.baselineWindow, r: P.rangeChange.recentWindow };
  const args = [W.b.start, W.b.end, W.r.start, W.r.end, R.wildOnly];
  const national = (await db().query<Row>(query(false), args)).rows;
  const regional = (await db().query<Row>(query(true), [...args, R.minRecordsPerWindow])).rows;

  const yrs = (w: { start: string; end: string }) => `${w.start.slice(0, 4)}–${w.end.slice(0, 4)}`;
  const r3 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Number(x.toFixed(3)));
  const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`);

  return [...national, ...regional].map((row): Insight => {
    const eb = Number(row.eb), er = Number(row.er);
    const rate = (n: number, e: number) => (e > 0 ? n / e : null);
    const ratioOf = (nb: number, nr: number) => {
      const b = rate(nb, eb), r = rate(nr, er);
      return b && r !== null ? r / b : null;
    };
    const ratio = ratioOf(row.nb, row.nr);
    const consistent = ratioOf(row.nbc, row.nrc);
    const interval = (x: number | null, se: number | null) =>
      x !== null && x > 0 && se !== null ? [x * Math.exp(-R.z * se), x * Math.exp(R.z * se)] as const : null;
    const ci = interval(consistent, row.nbc > 0 && row.nrc > 0 ? Math.sqrt(1 / row.nbc + 1 / row.nrc) : null);
    const vb = Number(row.vb), vr = Number(row.vr);
    const detection = vb > 0 && vr > 0 && row.db > 0 ? (row.dr / vr) / (row.db / vb) : null;
    const detectionCi = interval(
      detection,
      row.db > 0 && row.dr > 0 ? Math.sqrt(1 / row.db - 1 / vb + 1 / row.dr - 1 / vr) : null,
    );
    const enough = row.db >= R.minDetectionsPerWindow && row.dr >= R.minDetectionsPerWindow;
    const flag =
      enough && detection !== null && detectionCi && consistent !== null &&
      detection <= R.declineRatio && detectionCi[1] < 1 && consistent < 1 ? "decline"
      : enough && detection !== null && detectionCi && consistent !== null &&
        detection >= R.increaseRatio && detectionCi[0] > 1 && consistent > 1 ? "increase"
      : null;
    const region = row.region || null;
    const name = taxonLabel(row.vernacular_name, row.scientific_name);
    const per10k = (n: number, e: number) => r3(e > 0 ? (n / e) * 10_000 : null);

    return {
      insightType: "reporting_rate",
      taxonConceptId: row.taxon_concept_id,
      region,
      periodStart: W.r.start,
      periodEnd: W.r.end,
      figures: {
        flag,
        national_status: row.national_status,
        baseline_window: W.b,
        records: { baseline: row.nb, recent: row.nr },
        consistent_source_records: { baseline: row.nbc, recent: row.nrc },
        effort_group: row.effort_group,
        footprint_effort_records: { baseline: eb, recent: er },
        reporting_rate_per_10k: { baseline: per10k(row.nb, eb), recent: per10k(row.nr, er) },
        ratio: r3(ratio),
        consistent_source_ratio: r3(consistent),
        consistent_source_ratio_ci95: ci ? [r3(ci[0]), r3(ci[1])] : null,
        footprint_cells: row.cells,
        detections: { baseline: row.db, recent: row.dr },
        visits: { baseline: vb, recent: vr },
        detection_ratio: r3(detection),
        detection_ratio_ci95: detectionCi ? [r3(detectionCi[0]), r3(detectionCi[1])] : null,
      },
      confidence: {
        enough_detections: enough,
        datasets: row.datasets,
        consistent_datasets: row.consistent_datasets,
        baseline_share_from_sources_no_longer_recording: row.nb > 0 ? r3(1 - row.nbc / row.nb) : null,
        footprint_effort_ratio: eb > 0 ? r3(er / eb) : null,
      },
      summary:
        `${name}${region ? ` in ${region}` : ""}: reporting rate ${pct(detection)} — the share of cell-months with ` +
        `${row.effort_group === "all" ? "any" : row.effort_group} recording in its range that recorded it, ${yrs(W.b)} against ${yrs(W.r)} ` +
        `(${row.db} → ${row.dr} detections from sources recording it in both; record rate ${pct(consistent)})` +
        (flag ? ` — flagged as ${flag}.` : enough ? "." : " — too few detections to flag."),
    };
  });
}
