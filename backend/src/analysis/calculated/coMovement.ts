import { db } from "../../db/pool.ts";
import { CALCULATED_PARAMS as P } from "../params.ts";
import type { Insight } from "../runs.ts";
import { reportingRate } from "./reportingRate.ts";

/**
 * Insight #4 — regional co-movement: bioregions where several threatened taxa moved together. The
 * ecosystem signal, at the place-based scale the Threatened Species Action Plan manages at.
 *
 * Built on insight #3's regional results (a taxon–region pair is assessed when it has enough
 * detections in both windows). Per IBRA region: how many taxa were assessed, how many declined and
 * how many increased. A region is flagged when at least `minTaxa` taxa moved the same way and that
 * is more than the national rate predicts — an exact binomial upper tail, p < `alpha`, the expected
 * share being the share of all assessed taxon–region pairs that moved that way. So a region is not
 * flagged merely for having many taxa assessed.
 *
 * Range change (#2) is national only, so it does not enter here. The test treats taxa as
 * independent, which co-occurring species are not, and ~68 regions are tested in each direction;
 * the p-value is a screen, not an inference. A Benjamini–Hochberg q-value across regions (per
 * direction) is reported beside it so the multiple-testing burden is visible.
 */

/** Benjamini–Hochberg adjusted p-values, in input order. */
function bhAdjust(ps: number[]): number[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(ps.length);
  let min = 1;
  for (let r = order.length - 1; r >= 0; r--) {
    const [p, i] = order[r]!;
    min = Math.min(min, (p * ps.length) / (r + 1));
    q[i] = min;
  }
  return q;
}

/** P(X ≥ k) for X ~ Binomial(n, p), summed in log space. */
function binomialUpperTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const logChoose = (n: number, k: number) => {
    let s = 0;
    for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
    return s;
  };
  let total = 0;
  for (let i = k; i <= n; i++) total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, total);
}

export async function coMovement(): Promise<Insight[]> {
  const C = P.coMovement;
  const assessed = (await reportingRate()).filter((x) => x.region && x.confidence.enough_detections);
  const groups = new Map(
    (await db().query<{ taxon_concept_id: string; grp: string }>(
      `select taxon_concept_id,
              case when kingdom = 'Plantae' then 'plants' when taxon_class = 'Aves' then 'birds'
                   when taxon_class = 'Mammalia' then 'mammals' when taxon_class = 'Reptilia' then 'reptiles'
                   when taxon_class = 'Amphibia' then 'amphibians' else 'other' end as grp
       from corpus.taxa`,
    )).rows.map((r) => [r.taxon_concept_id, r.grp]),
  );

  const total = assessed.length;
  const share = (flag: string) => (total ? assessed.filter((x) => x.figures.flag === flag).length / total : 0);
  const expected = { decline: share("decline"), increase: share("increase") };

  const byRegion = new Map<string, Insight[]>();
  for (const x of assessed) byRegion.set(x.region!, [...(byRegion.get(x.region!) ?? []), x]);

  const W = P.rangeChange;
  const regions = [...byRegion].sort((a, b) => a[0].localeCompare(b[0]));
  const tail = (flag: string) =>
    regions.map(([, rows]) => binomialUpperTail(rows.filter((x) => x.figures.flag === flag).length, rows.length, expected[flag as "decline" | "increase"]));
  const pDeclines = tail("decline"), pIncreases = tail("increase");
  const qDeclines = bhAdjust(pDeclines), qIncreases = bhAdjust(pIncreases);
  const insights: Insight[] = [];
  for (const [idx, [region, rows]] of regions.entries()) {
    const moved = (flag: string) => rows.filter((x) => x.figures.flag === flag).map((x) => x.taxonConceptId!);
    const declining = moved("decline");
    const increasing = moved("increase");
    const pDecline = pDeclines[idx]!, pIncrease = pIncreases[idx]!;
    const flag =
      declining.length >= C.minTaxa && pDecline < C.alpha ? "co_decline"
      : increasing.length >= C.minTaxa && pIncrease < C.alpha ? "co_increase"
      : null;
    const groupCount = (ids: string[]) =>
      Object.fromEntries([...ids.reduce((m, id) => m.set(groups.get(id) ?? "other", (m.get(groups.get(id) ?? "other") ?? 0) + 1), new Map<string, number>())].sort());
    const names = (ids: string[]) =>
      ids.map((id) => rows.find((x) => x.taxonConceptId === id)!.summary.split(" in ")[0]).join("; ");
    const r3 = (x: number) => Number(x.toPrecision(3));

    insights.push({
      insightType: "co_movement",
      taxonConceptId: null,
      relatedTaxa: flag === "co_increase" ? increasing : declining,
      region,
      periodStart: W.recentWindow.start,
      periodEnd: W.recentWindow.end,
      figures: {
        flag,
        baseline_window: W.baselineWindow,
        taxa_assessed: rows.length,
        declines: declining.length,
        increases: increasing.length,
        expected_decline_share: r3(expected.decline),
        expected_increase_share: r3(expected.increase),
        p_decline: r3(pDecline),
        p_increase: r3(pIncrease),
        q_decline: r3(qDeclines[idx]!),
        q_increase: r3(qIncreases[idx]!),
        declining_groups: groupCount(declining),
        increasing_groups: groupCount(increasing),
        declining_taxa: declining,
        increasing_taxa: increasing,
      },
      confidence: {
        taxon_region_pairs_assessed_nationally: total,
        independence_assumed: true,
      },
      summary:
        `${region}: ${declining.length} of ${rows.length} assessed threatened taxa declined in reporting rate and ` +
        `${increasing.length} increased, ${W.baselineWindow.start.slice(0, 4)}–${W.baselineWindow.end.slice(0, 4)} against ` +
        `${W.recentWindow.start.slice(0, 4)}–${W.recentWindow.end.slice(0, 4)}` +
        (flag === "co_decline" ? ` — more declines than expected (p ${r3(pDecline)}): ${names(declining)}.`
          : flag === "co_increase" ? ` — more increases than expected (p ${r3(pIncrease)}): ${names(increasing)}.`
          : "."),
    });
  }
  return insights;
}
