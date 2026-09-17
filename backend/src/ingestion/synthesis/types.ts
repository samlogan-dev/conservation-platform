/**
 * AI analysis (page 5): one model call per species, region and window, over the numbers the
 * Statistics and Insights pages already compute — never over records or free text.
 *
 * The model is given an *evidence pack*: a flat list of named metrics with ids. It answers
 * through a tool schema, citing metric ids, and everything it says is checked back against
 * the pack before it is stored: a cited id that does not exist and a number that appears
 * nowhere in the evidence are both recorded on the insight, not hidden. That check is what
 * makes "what was surfaced, what was fabricated" measurable rather than asserted.
 */

export type MetricUnit = "count" | "share" | "metres" | "chars" | "text" | "flag";

export interface Metric {
  /** Dotted, stable, cite-able: `source.ala.records`, `join.inaturalist-ala.matched`. */
  id: string;
  label: string;
  value: number | string | boolean;
  unit: MetricUnit;
}

export interface EvidenceSection {
  key: string;
  title: string;
  metrics: Metric[];
}

export interface EvidencePack {
  scope: {
    speciesKey: string;
    regionKey: string;
    startDate: string;
    endDate: string;
    sources: string[];
  };
  sections: EvidenceSection[];
  metricCount: number;
  /** sha256 over the sections: the synthesis is stale when the family's numbers change. */
  hash: string;
}

export type InsightKind = "finding" | "data_quality" | "interpretation";
export type Confidence = "high" | "medium" | "low";

export interface Insight {
  title: string;
  /** One sentence: the finding itself. */
  essence: string;
  /** The evidence and why a practitioner should care. */
  detail: string;
  kind: InsightKind;
  /** 1–5, the model's ranking of value to a practitioner. */
  value: number;
  confidence: Confidence;
  /** Metric ids the insight rests on. */
  evidence: string[];
  caveat: string | null;
  /** Fact-check results, computed here, not by the model. */
  checks: {
    unknownCitations: string[];
    unverifiedNumbers: string[];
  };
}

export interface SynthesisReport {
  headline: string;
  insights: Insight[];
  limitations: string[];
  nextQuestions: string[];
}

export interface Synthesis {
  familyKey: string;
  scope: EvidencePack["scope"];
  /** The run whose page triggered the call; the evidence is the whole family regardless. */
  triggeredBy: { harvestKey: string; runId: string };
  model: string;
  promptVersion: string;
  /** 0 where the model accepted it; null where the model rejects the parameter (Claude 5 tier). */
  temperature: number | null;
  evidenceHash: string;
  metricCount: number;
  startedAt: string;
  finishedAt: string;
  usage: { requests: number; inputTokens: number; outputTokens: number };
  report: SynthesisReport;
  checks: { unknownCitations: number; unverifiedNumbers: number };
}

/** What the page reads: whether a synthesis can run, the evidence, and the stored result if any. */
export interface SynthesisStatus {
  configured: boolean;
  model: string;
  promptVersion: string;
  familyKey: string;
  evidence: EvidencePack;
  synthesis: Synthesis | null;
  /** The stored synthesis was generated from different numbers than the family holds now. */
  stale: boolean;
  running: boolean;
}
