import { anthropicConfigured, createDeterministic, makeAnthropic } from "../config/anthropic.ts";
import { buildEvidence, type FamilyLike } from "./evidence.ts";
import { PROMPT_VERSION, SYNTHESIS_TOOL, SYSTEM_PROMPT, buildUserMessage } from "./prompt.ts";
import { familyKeyOf, readSynthesis, writeSynthesis } from "./store.ts";
import type { Confidence, Insight, InsightKind, Synthesis, SynthesisReport, SynthesisStatus } from "./types.ts";
import { verifyInsight } from "./verify.ts";

/**
 * The synthesis job: evidence pack in, checked report out, one call per family.
 *
 * The frontier tier by default — this is the reasoning-heavy end of the two-tier hypothesis,
 * where the cheap tier does the bulk classification underneath. `claude-opus-5` is the
 * complete id as listed by the provider on 11 Sep 2026; override with ANALYSIS_MODEL, and
 * the id used is written into every result.
 */
const DEFAULT_MODEL = "claude-opus-5";
export const analysisModel = (): string => process.env.ANALYSIS_MODEL ?? DEFAULT_MODEL;

const KINDS: InsightKind[] = ["finding", "data_quality", "interpretation"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, max) : [];

// One call in flight per family at a time: a double click must not mean a double bill.
const inFlight = new Map<string, Promise<Synthesis>>();

export function isRunning(familyKey: string): boolean {
  return inFlight.has(familyKey);
}

export async function getSynthesisStatus(family: FamilyLike): Promise<SynthesisStatus> {
  const evidence = buildEvidence(family);
  const familyKey = familyKeyOf(family);
  const model = analysisModel();
  const synthesis = await readSynthesis(familyKey, model);
  return {
    configured: anthropicConfigured(),
    model,
    promptVersion: PROMPT_VERSION,
    familyKey,
    evidence,
    synthesis,
    stale: synthesis !== null && (synthesis.evidenceHash !== evidence.hash || synthesis.promptVersion !== PROMPT_VERSION),
    running: inFlight.has(familyKey),
  };
}

export interface SynthesiseOptions {
  triggeredBy: { harvestKey: string; runId: string };
  /** Re-run even when a synthesis for the current evidence already exists. */
  force?: boolean;
  onProgress?: (message: string) => void;
}

export async function synthesiseFamily(family: FamilyLike, options: SynthesiseOptions): Promise<Synthesis> {
  const familyKey = familyKeyOf(family);
  const running = inFlight.get(familyKey);
  if (running) return running;

  const task = (async () => {
    const log = options.onProgress ?? (() => {});
    const evidence = buildEvidence(family);
    const model = analysisModel();

    const existing = await readSynthesis(familyKey, model);
    if (existing && !options.force && existing.evidenceHash === evidence.hash && existing.promptVersion === PROMPT_VERSION) {
      log(`synthesis for ${familyKey} is current (evidence ${evidence.hash.slice(0, 12)}); use --force to regenerate`);
      return existing;
    }

    const client = makeAnthropic();
    const startedAt = new Date().toISOString();
    log(`synthesising ${familyKey}: ${evidence.metricCount} metrics → ${model} (prompt ${PROMPT_VERSION})`);

    const { response, temperature } = await createDeterministic(client, {
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [SYNTHESIS_TOOL],
      tool_choice: { type: "tool", name: SYNTHESIS_TOOL.name },
      messages: [{ role: "user", content: buildUserMessage(evidence) }],
    });

    const call = response.content.find((c) => c.type === "tool_use");
    const input = (call && call.type === "tool_use" ? call.input : {}) as Record<string, unknown>;

    const insights: Insight[] = (Array.isArray(input.insights) ? input.insights : []).slice(0, 7).map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const base: Omit<Insight, "checks"> = {
        title: str(r.title, 120),
        essence: str(r.essence, 400),
        detail: str(r.detail, 1200),
        kind: KINDS.includes(r.kind as InsightKind) ? (r.kind as InsightKind) : "interpretation",
        value: typeof r.value === "number" ? Math.min(5, Math.max(1, Math.round(r.value))) : 3,
        confidence: CONFIDENCES.includes(r.confidence as Confidence) ? (r.confidence as Confidence) : "low",
        evidence: strings(r.evidence, 20),
        caveat: str(r.caveat, 400) || null,
      };
      return { ...base, checks: verifyInsight(base, evidence) };
    });

    const report: SynthesisReport = {
      headline: str(input.headline, 300),
      insights,
      limitations: strings(input.limitations, 4),
      nextQuestions: strings(input.next_questions, 3),
    };

    const synthesis: Synthesis = {
      familyKey,
      scope: evidence.scope,
      triggeredBy: options.triggeredBy,
      model: response.model || model,
      promptVersion: PROMPT_VERSION,
      temperature,
      evidenceHash: evidence.hash,
      metricCount: evidence.metricCount,
      startedAt,
      finishedAt: new Date().toISOString(),
      usage: { requests: 1, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      report,
      checks: {
        unknownCitations: insights.reduce((sum, i) => sum + i.checks.unknownCitations.length, 0),
        unverifiedNumbers: insights.reduce((sum, i) => sum + i.checks.unverifiedNumbers.length, 0),
      },
    };

    const target = await writeSynthesis(synthesis);
    log(
      `wrote ${target}: ${insights.length} insights · ${synthesis.usage.inputTokens} in / ${synthesis.usage.outputTokens} out tokens · ` +
        `${synthesis.checks.unknownCitations} unknown citations · ${synthesis.checks.unverifiedNumbers} unverified numbers`,
    );
    return synthesis;
  })();

  inFlight.set(familyKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(familyKey);
  }
}
