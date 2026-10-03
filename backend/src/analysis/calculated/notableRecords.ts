import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as P, monthBounds } from "../params.ts";
import { type Insight, taxonLabel } from "../runs.ts";

/**
 * Insight #5 — notable records in the report month, statistical tier only. Each record is checked
 * against everything recorded before the month (from 2015), not just the baseline, so a taxon's
 * range keeps up with what is already known:
 *  - outside_range  further than the threshold from every earlier record of the taxon;
 *  - new_region     in an IBRA region where the taxon has no earlier record;
 *  - out_of_season  in a calendar month holding a tiny share of the taxon's baseline records
 *                   (judged only where the baseline is big enough to have a season at all).
 * These are the soft domain rules of the Week 3 Tier 2, carried into this insight.
 *
 * Records are grouped per taxon and region, so one observer logging the same bird five times is
 * one finding with five records, not five findings. Managed-population records are kept and
 * labelled: a reintroduction outside the known range is real news, but different news.
 */
export async function notableRecords(): Promise<Insight[]> {
  const { start, end } = monthBounds(P.reportMonth);
  const N = P.notableRecords;
  const telemetry = (
    await db().query<{ uid: string }>("select data_resource_uid as uid from corpus.datasets where kind = 'telemetry'")
  ).rows.map((r) => r.uid);

  const { rows } = await db().query<{
    record_id: string; taxon_concept_id: string; scientific_name: string | null; vernacular_name: string | null;
    national_status: string | null; ibra_region: string | null; state_province: string | null; event_date: string;
    coordinate_uncertainty_m: number | null; dataset_kind: string; data_resource_uid: string | null;
    nearest_prior_km: number | null; region_seen: boolean; month_share: number | null; baseline_records: number;
  }>(
    `with cur as (
       select a.* from corpus.analysable_occurrences a
       join corpus.taxon_tiers tt using (taxon_concept_id)
       where tt.statistical_tier and a.geom is not null
         and a.event_date >= $1::date and a.event_date < $2::date + 1
     ), season as (
       select taxon_concept_id, extract(month from event_date)::int as m, count(*) as n,
              sum(count(*)) over (partition by taxon_concept_id) as total
       from corpus.analysable_occurrences
       where event_date >= $3::date and event_date < $4::date + 1
         and taxon_concept_id in (select taxon_concept_id from cur)
       group by 1, 2
     )
     select c.record_id, c.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status,
            c.ibra_region, c.state_province, c.event_date, c.coordinate_uncertainty_m, c.dataset_kind, c.data_resource_uid,
            (select st_distance(c.geom::geography, p.geom::geography) / 1000.0
             from corpus.occurrences p
             where p.taxon_concept_id = c.taxon_concept_id and p.event_date < $1::date and p.is_valid
               and p.geom is not null and coalesce(p.data_resource_uid <> all($5::text[]), true)
             order by p.geom <-> c.geom limit 1)::float as nearest_prior_km,
            (c.ibra_region is null or exists (
               select 1 from corpus.occurrences p
               where p.taxon_concept_id = c.taxon_concept_id and p.ibra_region = c.ibra_region
                 and p.event_date < $1::date and p.is_valid)) as region_seen,
            (s.n::float / nullif(s.total, 0))::float as month_share,
            coalesce((select max(total) from season s2 where s2.taxon_concept_id = c.taxon_concept_id), 0)::int as baseline_records
     from cur c
     join corpus.taxa t using (taxon_concept_id)
     left join season s on s.taxon_concept_id = c.taxon_concept_id and s.m = extract(month from c.event_date)::int`,
    [start, end, P.baseline.start, P.baseline.end, telemetry],
  );

  // Reasons per record, then grouped per taxon and region.
  const groups = new Map<string, { first: (typeof rows)[number]; records: (typeof rows)[number][]; reasons: Set<string>; maxKm: number | null }>();
  for (const r of rows) {
    const reasons: string[] = [];
    if (r.nearest_prior_km === null || r.nearest_prior_km > N.outsideRangeKm) reasons.push("outside_range");
    if (!r.region_seen) reasons.push("new_region");
    if (r.baseline_records >= N.seasonMinBaselineRecords && (r.month_share ?? 0) < N.outOfSeasonMaxShare) {
      reasons.push("out_of_season");
    }
    if (reasons.length === 0) continue;
    const key = `${r.taxon_concept_id}|${r.ibra_region ?? r.state_province ?? ""}`;
    const g = groups.get(key) ?? { first: r, records: [], reasons: new Set<string>(), maxKm: null };
    g.records.push(r);
    reasons.forEach((x) => g.reasons.add(x));
    if (r.nearest_prior_km !== null) g.maxKm = Math.max(g.maxKm ?? 0, r.nearest_prior_km);
    groups.set(key, g);
  }

  const describe: Record<string, string> = {
    outside_range: `more than ${N.outsideRangeKm} km from any earlier record`,
    new_region: "first in this bioregion since 2015",
    out_of_season: "outside its usual months",
  };
  const insights: Insight[] = [];
  for (const { first: r, records, reasons, maxKm } of groups.values()) {
    const managed = records.filter((x) => x.dataset_kind === "managed").length;
    const imprecise = records.filter((x) => x.coordinate_uncertainty_m === null || x.coordinate_uncertainty_m > 2000).length;
    const region = r.ibra_region ?? null;
    const where = r.ibra_region ?? (r.state_province ? `${r.state_province} (outside IBRA)` : "an unassigned area");
    insights.push({
      insightType: "notable_record",
      taxonConceptId: r.taxon_concept_id,
      region,
      periodStart: start,
      periodEnd: end,
      figures: {
        reasons: [...reasons].sort(),
        national_status: r.national_status,
        records: records.length,
        record_ids: records.slice(0, 20).map((x) => x.record_id),
        max_distance_to_prior_km: maxKm === null ? null : Math.round(maxKm),
        state_province: r.state_province,
        managed_records: managed,
      },
      confidence: {
        records: records.length,
        share_imprecise: Number((imprecise / records.length).toFixed(3)),
        managed: managed > 0,
        baseline_records: r.baseline_records,
      },
      summary:
        `${taxonLabel(r.vernacular_name, r.scientific_name)} in ${where}, ${P.reportMonth}: ` +
        `${records.length} record${records.length === 1 ? "" : "s"} ${[...reasons].sort().map((x) => describe[x]).join("; ")}` +
        (maxKm !== null && reasons.has("outside_range") ? ` (up to ${Math.round(maxKm)} km away)` : "") +
        (managed ? ` — ${managed} from a managed population.` : "."),
    });
  }
  return insights;
}
