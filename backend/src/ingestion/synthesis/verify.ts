import { renderValue } from "./evidence.ts";
import type { EvidencePack, Insight, Metric } from "./types.ts";

/**
 * The fact-check list, run on the model's output rather than asked of the model.
 *
 * Two checks, both mechanical: every metric id an insight cites must exist in the pack, and
 * every number in the insight's prose must be a value from the pack — or a difference, sum,
 * or ratio of two metrics the insight cites. Anything else is recorded as unverified. It is
 * not removed: the reader sees the claim and sees that the evidence did not contain it.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?(?:\s?%)?/g;

/** Small integers read as ordinals or thresholds ("two sources", "10 km"), not as figures. */
const EXEMPT_BELOW = 13;

const round = (n: number, dp: number): string => n.toFixed(dp);

/** Every way a metric's value might be quoted. */
function forms(m: Metric): { counts: Set<number>; pcts: Set<string> } {
  const counts = new Set<number>();
  const pcts = new Set<string>();
  if (typeof m.value !== "number") return { counts, pcts };
  if (m.unit === "share") {
    const p = m.value * 100;
    pcts.add(round(p, 0));
    pcts.add(round(p, 1));
    // "roughly a third" is prose; "33%" is what gets checked. Also allow the rounded integer
    // quoted without the sign, which the model sometimes does ("about 39").
    counts.add(Number(round(p, 0)));
  } else {
    counts.add(Math.round(m.value));
    counts.add(Number(round(m.value, 1)));
  }
  return { counts, pcts };
}

function derived(cited: Metric[]): { counts: Set<number>; pcts: Set<string> } {
  const counts = new Set<number>();
  const pcts = new Set<string>();
  const numeric = cited.filter((m): m is Metric & { value: number } => typeof m.value === "number" && m.unit !== "share");
  for (const a of numeric) {
    for (const b of numeric) {
      if (a === b) continue;
      counts.add(Math.abs(a.value - b.value));
      counts.add(a.value + b.value);
      if (b.value !== 0) {
        const ratio = (a.value / b.value) * 100;
        pcts.add(round(ratio, 0));
        pcts.add(round(ratio, 1));
        counts.add(Number(round(a.value / b.value, 1)));
      }
    }
  }
  return { counts, pcts };
}

export function verifyInsight(
  insight: Omit<Insight, "checks">,
  pack: EvidencePack,
): Insight["checks"] {
  const byId = new Map<string, Metric>();
  for (const s of pack.sections) for (const m of s.metrics) byId.set(m.id, m);

  const unknownCitations = insight.evidence.filter((id) => !byId.has(id));
  const cited = insight.evidence.map((id) => byId.get(id)).filter((m): m is Metric => m !== undefined);

  const counts = new Set<number>();
  const pcts = new Set<string>();
  for (const m of byId.values()) {
    const f = forms(m);
    for (const c of f.counts) counts.add(c);
    for (const p of f.pcts) pcts.add(p);
  }
  const d = derived(cited);
  for (const c of d.counts) counts.add(c);
  for (const p of d.pcts) pcts.add(p);

  const prose = [insight.title, insight.essence, insight.detail, insight.caveat ?? ""].join(" ");
  // Dates and the window's years are not figures.
  const stripped = prose.replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, " ").replace(/\b(19|20)\d{2}\b/g, " ");

  const unverified: string[] = [];
  for (const raw of stripped.match(NUMBER) ?? []) {
    const token = raw.trim();
    const isPct = token.endsWith("%");
    const n = Number(token.replace(/[%,\s]/g, ""));
    if (!Number.isFinite(n)) continue;
    if (isPct) {
      if (pcts.has(round(n, 0)) || pcts.has(round(n, 1))) continue;
      // A whole-number percentage the pack holds at one decimal ("39%" for 39.4%).
      if ([...pcts].some((p) => Math.abs(Number(p) - n) < 0.55)) continue;
    } else {
      if (n < EXEMPT_BELOW) continue;
      if (counts.has(n) || counts.has(Math.round(n))) continue;
      if ([...counts].some((c) => Math.abs(c - n) < 0.051)) continue;
    }
    if (!unverified.includes(token)) unverified.push(token);
  }

  return { unknownCitations, unverifiedNumbers: unverified };
}

/** The cited metrics an insight can show as chips, resolved and rendered. */
export function resolveCitations(ids: string[], pack: EvidencePack): { id: string; label: string; value: string }[] {
  const byId = new Map<string, Metric>();
  for (const s of pack.sections) for (const m of s.metrics) byId.set(m.id, m);
  return ids.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ id, label: m.label, value: renderValue(m) }] : [];
  });
}
