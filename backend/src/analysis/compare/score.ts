import { db } from "../../db/pool.ts";
import { executeReadOnly } from "../ai/queryTool.ts";

/**
 * Scores one AI run against one calculated run — the evaluation design in CLAUDE.md:
 *
 *  - Reproduction (guided runs): each AI insight of a computed type is matched to the calculated
 *    insight with the same type, taxon, region and period, and its figures compared. Headline
 *    counts are compared with the calculated arm's counts. The calculated arm is the reference,
 *    not the truth: a mismatch is a case for adjudication, not an automatic AI error.
 *  - Discovery (open runs): for each computed type, the calculated arm's top findings by severity
 *    form a priority set; recall is the share the AI surfaced for the same taxon (and region where
 *    the finding is regional), under any label.
 *  - Grounding (both): every cited query is re-run and its rows compared (order-insensitive) with
 *    what was logged; every number in the insight's figures is checked against the cited results
 *    — as a value, a column total, or a difference, ratio or percentage change of two values.
 *    Numbers that fail are listed for adjudication as possible fabrications.
 *
 * 2026-10-03.2, after the first guided run — matching made fair, the strict checks kept:
 *  - the evidence-gap headline counts every taxon under the threshold, as the brief defines it,
 *    not only those the calculated arm labels evidence_gap because they are not also silent;
 *  - national silent-species insights match on taxon alone: the brief fixes the period, and an
 *    evidence gap is fairly reported over "since 2015";
 *  - notable-record reasons are compared after mapping free-text labels onto the calculated arm's;
 *  - dates are read as text, so a date column is never shifted by the host's time zone.
 */
export const SCORER_VERSION = "2026-10-03.2";
const PRIORITY_K = 15;

interface Row {
  insight_id: string; insight_type: string; taxon_concept_id: string | null; region: string | null;
  period_start: string; period_end: string; figures: Record<string, unknown>; summary: string; query_ids: string[];
}

const day = (d: string) => d.slice(0, 10);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim())) return Number(v);
  return null;
};
const close = (a: number | null, b: number | null, rel = 0.01, abs = 0.0015) =>
  a !== null && b !== null && Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

async function insights(runId: string): Promise<Row[]> {
  const { rows } = await db().query<Row>(
    `select insight_id, insight_type, taxon_concept_id, region, period_start::text, period_end::text, figures, summary, query_ids
     from analysis.insights where run_id = $1 order by insight_id`,
    [runId],
  );
  return rows;
}

/** The figure comparisons that matter for each computed type. */
function compareFigures(type: string, ai: Record<string, unknown>, calc: Record<string, unknown>): Record<string, boolean> {
  const get = (o: Record<string, unknown>, p: string) => p.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
  const same = (p: string) => JSON.stringify(get(ai, p)) === JSON.stringify(get(calc, p));
  const near = (p: string, rel?: number) => close(num(get(ai, p)), num(get(calc, p)), rel);
  switch (type) {
    case "silent_species":
      return {
        // A taxon both silent and data-poor is labelled silent by the calculated arm; the AI may
        // fairly lead with either.
        kind: same("kind") || (get(ai, "kind") === "evidence_gap" && get(calc, "evidence_gap") === true),
        records_since_2015: near("records_since_2015", 0),
        last_record_date: get(ai, "last_record_date") === undefined || String(get(ai, "last_record_date")).slice(0, 10) === get(calc, "last_record_date"),
      };
    case "range_change":
      return {
        flag: same("flag"),
        aoo_10km_baseline: near("aoo_10km_km2.baseline", 0),
        aoo_10km_recent: near("aoo_10km_km2.recent", 0),
        aoo_10km_change: near("aoo_10km_km2.change", 0.02),
        eoo_change: near("eoo_km2.change", 0.05),
        records_baseline: near("records.baseline", 0),
        records_recent: near("records.recent", 0),
      };
    case "notable_record": {
      const r = (o: Record<string, unknown>) => JSON.stringify([...new Set(((o.reasons as string[]) ?? []).map(reasonLabel))].sort());
      return { reasons: r(ai) === r(calc), records: near("records", 0) };
    }
    default:
      return {};
  }
}

/** A notable-record reason in the calculated arm's vocabulary, from whatever label the AI used. */
function reasonLabel(reason: string): string {
  const s = reason.toLowerCase();
  if (/outside_range|\bkm\b|distance|range/.test(s)) return "outside_range";
  if (/new_region|region|ibra/.test(s)) return "new_region";
  if (/season|month|%/.test(s)) return "out_of_season";
  return s;
}

/** The calculated arm's headline counts, for comparison with the AI's headline insights. */
function headlineCounts(calc: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of calc) {
    if (r.insight_type === "silent_species") {
      const k = String(r.figures.kind);
      counts[`silent_species:${k}`] = (counts[`silent_species:${k}`] ?? 0) + 1;
      // The brief defines an evidence gap whether or not the taxon is also silent.
      if (k === "silent" && r.figures.evidence_gap === true) counts["silent_species:evidence_gap"] = (counts["silent_species:evidence_gap"] ?? 0) + 1;
    } else if (r.insight_type === "range_change" && r.figures.flag) {
      const k = String(r.figures.flag);
      counts[`range_change:${k}`] = (counts[`range_change:${k}`] ?? 0) + 1;
    } else if (r.insight_type === "notable_record") {
      counts["notable_record:groups"] = (counts["notable_record:groups"] ?? 0) + 1;
    }
  }
  return counts;
}

/** The calculated arm's most important findings per type: what an open-brief AI should surface. */
function prioritySets(calc: Row[]): Record<string, Row[]> {
  const n = (r: Row, p: string) => num(p.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], r.figures)) ?? 0;
  const top = (rows: Row[], score: (r: Row) => number) => [...rows].sort((a, b) => score(b) - score(a)).slice(0, PRIORITY_K);
  return {
    // Silent taxa that used to be recorded most — the losses a practitioner would most want to know about.
    silent: top(calc.filter((r) => r.figures.kind === "silent"), (r) => n(r, "baseline_annual_mean")),
    regional_silence: top(calc.filter((r) => r.figures.kind === "regional_silence"), (r) => n(r, "baseline_records")),
    // Contractions with the most baseline evidence behind them.
    contraction: top(calc.filter((r) => r.figures.flag === "contraction"), (r) => Math.min(n(r, "records.baseline"), 1e9) * -n(r, "aoo_10km_km2.change")),
    notable: top(calc.filter((r) => r.insight_type === "notable_record"), (r) => n(r, "max_distance_to_prior_km")),
  };
}

/** Every numeric leaf of an object, with its path. */
function numericLeaves(o: unknown, prefix = ""): { path: string; value: number }[] {
  if (Array.isArray(o)) return o.flatMap((v, i) => numericLeaves(v, `${prefix}[${i}]`));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => numericLeaves(v, prefix ? `${prefix}.${k}` : k));
  const v = num(o);
  return v === null ? [] : [{ path: prefix, value: v }];
}

/** Is `x` a value in the results, or a difference, ratio or percentage change of two of them? */
function grounded(x: number, values: number[]): boolean {
  const decimals = (String(x).split(".")[1] ?? "").length;
  const matches = (v: number) => close(x, v, 0.001, 0) || Number(v.toFixed(decimals)) === x;
  if (values.some(matches)) return true;
  const pool = values.slice(0, 400);
  for (const a of pool) {
    for (const b of pool) {
      if (b === 0) continue;
      const cands = [a - b, a / b, (a - b) / b, ((a - b) / b) * 100, (a / b) * 100];
      if (cands.some((c) => Number.isFinite(c) && matches(c))) return true;
    }
  }
  return false;
}

export async function scoreRun(aiRunId: string, calculatedRunId: string): Promise<{ summary: Record<string, unknown>; details: unknown }> {
  const run = (await db().query<{ brief: string }>("select brief from analysis.runs where run_id = $1 and arm = 'ai'", [aiRunId])).rows[0];
  if (!run) throw new Error(`no AI run ${aiRunId}`);
  const [ai, calc] = await Promise.all([insights(aiRunId), insights(calculatedRunId)]);
  const key = (r: Row) =>
    r.insight_type === "silent_species" && r.region === null
      ? `${r.insight_type}|${r.taxon_concept_id}||national`
      : `${r.insight_type}|${r.taxon_concept_id}|${r.region ?? ""}|${day(r.period_start)}|${day(r.period_end)}`;
  const calcByKey = new Map(calc.map((r) => [key(r), r]));

  // --- Reproduction ---
  const reproduction: unknown[] = [];
  const headlineChecks: unknown[] = [];
  const counts = headlineCounts(calc);
  let matched = 0, unmatched = 0, figuresAgree = 0, figuresTotal = 0;
  for (const r of ai.filter((x) => x.insight_type !== "other")) {
    if (r.taxon_concept_id === null && r.region === null) {
      const k = r.insight_type === "silent_species" ? `silent_species:${r.figures.kind}` :
        r.insight_type === "range_change" ? `range_change:${r.figures.flag}` : "notable_record:groups";
      headlineChecks.push({ insight_id: r.insight_id, key: k, ai: num(r.figures.count), calculated: counts[k] ?? 0, agrees: num(r.figures.count) === (counts[k] ?? 0) });
      continue;
    }
    const c = calcByKey.get(key(r));
    if (!c) { unmatched++; reproduction.push({ insight_id: r.insight_id, key: key(r), matched: false, summary: r.summary }); continue; }
    matched++;
    const checks = compareFigures(r.insight_type, r.figures, c.figures);
    const agree = Object.values(checks).filter(Boolean).length;
    figuresAgree += agree;
    figuresTotal += Object.keys(checks).length;
    reproduction.push({ insight_id: r.insight_id, key: key(r), matched: true, checks, calculated_insight_id: c.insight_id });
  }

  // --- Discovery ---
  const sets = prioritySets(calc);
  const aiTaxa = new Set(ai.map((r) => r.taxon_concept_id).filter(Boolean));
  const aiTaxonRegion = new Set(ai.map((r) => `${r.taxon_concept_id}|${r.region ?? ""}`));
  const discovery: Record<string, { found: number; of: number; missed: string[] }> = {};
  for (const [name, rows] of Object.entries(sets)) {
    const regional = name === "regional_silence";
    const hits = rows.filter((r) => regional ? aiTaxonRegion.has(`${r.taxon_concept_id}|${r.region ?? ""}`) : aiTaxa.has(r.taxon_concept_id));
    discovery[name] = { found: hits.length, of: rows.length, missed: rows.filter((r) => !hits.includes(r)).map((r) => r.summary.slice(0, 120)) };
  }
  const aiOnTaxaNotFlagged = ai.filter((r) => r.taxon_concept_id && !calc.some((c) => c.taxon_concept_id === r.taxon_concept_id && (c.figures.kind || c.figures.flag || c.insight_type === "notable_record"))).length;

  // --- Grounding ---
  const queryIds = [...new Set(ai.flatMap((r) => r.query_ids.map(Number)))];
  const logged = queryIds.length
    ? (await db().query<{ query_id: string; sql: string; result_hash: string | null }>("select query_id, sql, result_hash from analysis.ai_queries where query_id = any($1::bigint[])", [queryIds])).rows
    : [];
  const rerun = new Map<number, { reproduced: boolean; values: number[] }>();
  for (const q of logged) {
    const out = await executeReadOnly(q.sql);
    // Hashes ignore row order, so equal hashes mean the same rows (within the row cap).
    const reproduced = out.error === null && out.resultHash === q.result_hash;
    const values = out.rows.flat().map(num).filter((v): v is number => v !== null);
    // Column totals: an AI may report the sum of a breakdown it queried.
    for (let c = 0; c < out.columns.length; c++) {
      const col = out.rows.map((row) => num(row[c])).filter((v): v is number => v !== null);
      if (col.length > 1) values.push(col.reduce((a, b) => a + b, 0));
    }
    rerun.set(Number(q.query_id), { reproduced, values });
  }
  const grounding: unknown[] = [];
  let numbersTotal = 0, numbersGrounded = 0, insightsFullyGrounded = 0, queriesReproduced = 0;
  for (const q of rerun.values()) if (q.reproduced) queriesReproduced++;
  for (const r of ai) {
    const values = r.query_ids.flatMap((id) => rerun.get(Number(id))?.values ?? []);
    const leaves = numericLeaves(r.figures);
    const failed = leaves.filter((l) => !grounded(l.value, values));
    numbersTotal += leaves.length;
    numbersGrounded += leaves.length - failed.length;
    if (failed.length === 0) insightsFullyGrounded++;
    if (failed.length) grounding.push({ insight_id: r.insight_id, summary: r.summary, ungrounded: failed });
  }

  const pct = (a: number, b: number) => (b ? Number((a / b).toFixed(3)) : null);
  const summary = {
    scorer_version: SCORER_VERSION,
    brief: run.brief,
    ai_insights: ai.length,
    reproduction: run.brief === "guided"
      ? {
          matched, unmatched,
          figure_agreement: pct(figuresAgree, figuresTotal),
          headline_counts: headlineChecks,
        }
      : null,
    discovery: Object.fromEntries(Object.entries(discovery).map(([k, v]) => [k, `${v.found}/${v.of}`])),
    discovery_recall_overall: pct(Object.values(discovery).reduce((a, v) => a + v.found, 0), Object.values(discovery).reduce((a, v) => a + v.of, 0)),
    ai_insights_on_taxa_the_calculated_arm_did_not_flag: aiOnTaxaNotFlagged,
    grounding: {
      queries_cited: queryIds.length,
      queries_reproduced: queriesReproduced,
      numbers: numbersTotal,
      numbers_grounded: pct(numbersGrounded, numbersTotal),
      insights_fully_grounded: pct(insightsFullyGrounded, ai.length),
    },
  };
  const details = { reproduction, discovery, grounding };
  await db().query(
    "insert into analysis.comparisons (ai_run_id, calculated_run_id, scorer_version, summary, details) values ($1, $2, $3, $4, $5)",
    [aiRunId, calculatedRunId, SCORER_VERSION, JSON.stringify(summary), JSON.stringify(details)],
  );
  return { summary, details };
}
