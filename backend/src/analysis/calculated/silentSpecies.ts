import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as P, monthBounds } from "../params.ts";
import { type Insight, taxonLabel } from "../runs.ts";

/**
 * Insight #1 — silent species and evidence gaps. Every listed taxon in the corpus is considered,
 * sparse ones included: they are the point of this insight.
 *
 * Three findings, all as `silent_species` insights, told apart by `figures.kind`:
 *  - `silent`           no analysable record in the lookback window up to the report month's end;
 *  - `evidence_gap`     too few analysable records since 2015 to say anything (whether or not
 *                       recently recorded) — the monitoring gap itself;
 *  - `regional_silence` recorded nationally in the window, but not in an IBRA region where it had
 *                       baseline records — a possible local loss, or a lapsed survey.
 *
 * Limitation, stated rather than hidden: a listed taxon with no record at all since 2015 never
 * entered the corpus, so the most silent taxa of all are invisible here.
 */
export async function silentSpecies(): Promise<Insight[]> {
  const { end: periodEnd } = monthBounds(P.reportMonth);
  const S = P.silentSpecies;
  const windowStart = new Date(`${periodEnd}T00:00:00Z`);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - S.lookbackMonths);
  windowStart.setUTCDate(windowStart.getUTCDate() + 1);
  const periodStart = windowStart.toISOString().slice(0, 10);
  const insights: Insight[] = [];
  const baselineYears = Number(P.baseline.end.slice(0, 4)) - Number(P.baseline.start.slice(0, 4)) + 1;

  // --- National: silent and evidence-gap taxa ---
  const national = await db().query<{
    taxon_concept_id: string; scientific_name: string | null; vernacular_name: string | null;
    national_status: string | null; records_since_2015: number; records_in_window: number;
    last_record_at: string | null; baseline_annual_mean: number; datasets: number;
    share_imprecise: number | null; share_managed: number | null;
  }>(
    `select t.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status,
            count(a.record_id)::int as records_since_2015,
            count(a.record_id) filter (where a.event_day >= $1::date)::int as records_in_window,
            max(a.event_day)::text as last_record_at,
            (count(a.record_id) filter (where a.event_day >= $3::date and a.event_day < $4::date + 1) / $5::float)::float as baseline_annual_mean,
            count(distinct a.data_resource_uid)::int as datasets,
            avg((a.coordinate_uncertainty_m is null or a.coordinate_uncertainty_m > 2000)::int)::float as share_imprecise,
            avg((a.population = 'managed')::int)::float as share_managed
     from corpus.taxa t
     left join corpus.analysable_occurrences a
       on a.taxon_concept_id = t.taxon_concept_id and a.event_day < $2::date + 1
     group by t.taxon_concept_id`,
    [periodStart, periodEnd, P.baseline.start, P.baseline.end, baselineYears],
  );

  for (const r of national.rows) {
    const silent = r.records_in_window === 0;
    const gap = r.records_since_2015 < S.evidenceGapMaxRecords;
    if (!silent && !gap) continue;
    const kind = silent ? "silent" : "evidence_gap";
    const name = taxonLabel(r.vernacular_name, r.scientific_name);
    const last = r.last_record_at; // event_day as text — a local date, never shifted through a JS Date
    const monthsSince = last
      ? Math.floor((Date.parse(periodEnd) - Date.parse(last)) / (30.44 * 86_400_000))
      : null;
    insights.push({
      insightType: "silent_species",
      taxonConceptId: r.taxon_concept_id,
      region: null,
      periodStart,
      periodEnd,
      figures: {
        kind,
        evidence_gap: gap,
        national_status: r.national_status,
        last_record_date: last,
        months_since_last_record: monthsSince,
        records_in_window: r.records_in_window,
        records_since_2015: r.records_since_2015,
        baseline_annual_mean: Number(r.baseline_annual_mean.toFixed(2)),
      },
      confidence: {
        records_since_2015: r.records_since_2015,
        datasets: r.datasets,
        share_imprecise: r.share_imprecise === null ? null : Number(r.share_imprecise.toFixed(3)),
        share_managed: r.share_managed === null ? null : Number(r.share_managed.toFixed(3)),
      },
      summary: silent
        ? `${name} (${r.national_status ?? "status unknown"}) has no record in the ${S.lookbackMonths} months to ${periodEnd}` +
          (last ? `; last recorded ${last}.` : "; no analysable record since 2015.") +
          (gap ? ` Only ${r.records_since_2015} records since 2015.` : "")
        : `${name} (${r.national_status ?? "status unknown"}) has only ${r.records_since_2015} records since 2015 — too few to judge its trend.`,
    });
  }

  // --- Regional: gone quiet in a bioregion while still recorded nationally ---
  const regional = await db().query<{
    taxon_concept_id: string; scientific_name: string | null; vernacular_name: string | null;
    national_status: string | null; ibra_region: string; baseline_records: number;
    records_since_2015: number; last_record_at: string; datasets: number;
  }>(
    `with nationally_recent as (
       select distinct taxon_concept_id from corpus.analysable_occurrences
       where event_day >= $1::date and event_day < $2::date + 1
     )
     select a.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status, a.ibra_region,
            count(*) filter (where a.event_day >= $3::date and a.event_day < $4::date + 1)::int as baseline_records,
            count(*)::int as records_since_2015,
            max(a.event_day)::text as last_record_at,
            count(distinct a.data_resource_uid)::int as datasets
     from corpus.analysable_occurrences a
     join nationally_recent n using (taxon_concept_id)
     join corpus.taxa t using (taxon_concept_id)
     where a.ibra_region is not null and a.event_day < $2::date + 1
     group by a.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status, a.ibra_region
     having count(*) filter (where a.event_day >= $3::date and a.event_day < $4::date + 1) >= $5
        and max(a.event_day) < $1::date`,
    [periodStart, periodEnd, P.baseline.start, P.baseline.end, S.regionalMinBaselineRecords],
  );

  for (const r of regional.rows) {
    const last = r.last_record_at;
    insights.push({
      insightType: "silent_species",
      taxonConceptId: r.taxon_concept_id,
      region: r.ibra_region,
      periodStart,
      periodEnd,
      figures: {
        kind: "regional_silence",
        national_status: r.national_status,
        last_record_date: last,
        baseline_records: r.baseline_records,
        records_since_2015: r.records_since_2015,
      },
      confidence: { baseline_records: r.baseline_records, datasets: r.datasets },
      summary:
        `${taxonLabel(r.vernacular_name, r.scientific_name)} is still recorded nationally but not in ` +
        `${r.ibra_region} since ${last}, despite ${r.baseline_records} records there in 2015–19.`,
    });
  }
  return insights;
}
