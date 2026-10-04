import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../db/pool.ts";
import { AI_MODEL, makeAnthropic } from "../../ingestion/config/anthropic.ts";
import { INGESTION } from "../../ingestion/config/ingestion.ts";
import { type Insight, type InsightType, finishRun, insertInsights, startRun } from "../runs.ts";
import { type Brief, PROMPT_VERSION, briefText, systemPrompt, tools } from "./prompt.ts";
import { formatForModel, runQuery } from "./queryTool.ts";

/**
 * The AI arm: Claude Opus 5.5 with read-only SQL over the corpus, recording insights in the same
 * shape the calculated arm writes. One call of runAiArm is one row in analysis.runs.
 *
 * Deliberately not done: no server-side model fallback. A refused request ends the run as failed,
 * logged, rather than silently continuing on a different model — a run's insights must all come
 * from the model the run records, or the comparison between arms means nothing.
 *
 * No temperature is sent (Opus 5.5 rejects it) and thinking is always adaptive, so runs are not
 * reproducible token for token; run-to-run consistency is measured by repeating runs.
 */
export const AI_PARAMS = {
  version: "2026-10-04.1", // .1: dropped streams are retried (streamRetries)
  effort: "high" as const,
  maxTokensPerTurn: 32_000,
  maxTurns: 80,
  /** Hard stop on estimated spend per run, USD. */
  maxCostUsd: 10,
  /** Warn the model when this close to either limit. */
  warnTurnsLeft: 6,
  warnCostShare: 0.8,
  /** Re-sends of a turn whose stream dropped mid-response ("terminated"), with backoff. */
  streamRetries: 3,
  /**
   * Claude Opus 5.5 per-million-token prices, USD, from Anthropic's model table (cached
   * 2026-09-25): input $4, output $20, cache reads $0.20; 5-minute cache writes at 1.25× input.
   * Used only to estimate spend and enforce the cap — the bill is the authority.
   */
  pricePerMTok: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const costOf = (u: Usage): number => {
  const p = AI_PARAMS.pricePerMTok;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6;
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a record_insight call; return the insight or the reason it was refused. */
async function validateInsight(
  runId: string,
  brief: Brief,
  input: Record<string, unknown>,
  regions: Set<string>,
): Promise<Insight | string> {
  const types: InsightType[] = ["silent_species", "range_change", "notable_record", "other"];
  const insightType = brief === "guided" ? input.insight_type : "other";
  if (!types.includes(insightType as InsightType)) return `insight_type must be one of ${types.join(", ")}`;
  if (brief === "open" && (typeof input.category !== "string" || !input.category.trim())) return "category is required";
  if (!isDate(input.period_start) || !isDate(input.period_end)) return "period_start and period_end must be YYYY-MM-DD dates";
  if (typeof input.summary !== "string" || !input.summary.trim()) return "summary is required";
  if (!isObject(input.figures)) return "figures must be an object";
  if (input.confidence !== undefined && !isObject(input.confidence)) return "confidence must be an object";

  const taxon = input.taxon_concept_id ?? null;
  if (taxon !== null) {
    if (typeof taxon !== "string") return "taxon_concept_id must be a string or null";
    const { rowCount } = await db().query("select 1 from corpus.taxa where taxon_concept_id = $1", [taxon]);
    if (!rowCount) return `taxon_concept_id ${taxon} is not in corpus.taxa — copy it exactly from a query result`;
  }
  const related = input.related_taxa ?? [];
  if (!Array.isArray(related) || !related.every((x) => typeof x === "string")) return "related_taxa must be an array of taxon_concept_id strings";
  if (related.length) {
    const { rows: known } = await db().query<{ taxon_concept_id: string }>(
      "select taxon_concept_id from corpus.taxa where taxon_concept_id = any($1::text[])", [related],
    );
    const unknown = related.filter((x) => !known.some((k) => k.taxon_concept_id === x));
    if (unknown.length) return `related_taxa not in corpus.taxa: ${unknown.join(", ")} — copy them exactly from a query result`;
  }
  const region = input.region ?? null;
  if (region !== null && (typeof region !== "string" || !regions.has(region))) {
    return `region "${String(region)}" is not an IBRA region in the corpus — use ibra_region exactly, or null`;
  }

  const ids = input.query_ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => Number.isInteger(x))) {
    return "query_ids must cite at least one run_sql query_id";
  }
  const { rows } = await db().query<{ query_id: string; error: string | null }>(
    "select query_id, error from analysis.ai_queries where run_id = $1 and query_id = any($2::bigint[])",
    [runId, ids],
  );
  const found = new Map(rows.map((r) => [Number(r.query_id), r.error]));
  const missing = (ids as number[]).filter((id) => !found.has(id));
  if (missing.length) return `query_ids ${missing.join(", ")} are not queries from this run`;
  const failed = (ids as number[]).filter((id) => found.get(id) !== null);
  if (failed.length) return `query_ids ${failed.join(", ")} failed and cannot support an insight`;

  return {
    insightType: insightType as InsightType,
    taxonConceptId: taxon,
    relatedTaxa: related as string[],
    region,
    periodStart: input.period_start,
    periodEnd: input.period_end,
    figures: brief === "open" ? { category: input.category, ...input.figures } : input.figures,
    confidence: (input.confidence as Record<string, unknown>) ?? {},
    summary: input.summary,
    queryIds: ids as number[],
  };
}

export interface AiRunSummary {
  runId: string;
  brief: Brief;
  turns: number;
  queries: number;
  insights: number;
  stopReason: string;
  usage: Usage;
  estimatedCostUsd: number;
}

export async function runAiArm(brief: Brief, options: { onProgress?: (m: string) => void } = {}): Promise<AiRunSummary> {
  const log = options.onProgress ?? (() => {});
  const client = makeAnthropic();
  const system = await systemPrompt();
  const toolDefs = tools(brief);
  const regions = new Set(
    (await db().query<{ r: string }>("select distinct ibra_region as r from corpus.occurrences where ibra_region is not null")).rows.map((x) => x.r),
  );

  const runId = await startRun({ arm: "ai", brief, params: AI_PARAMS, model: AI_MODEL, promptVersion: PROMPT_VERSION });
  log(`ai run ${runId} — ${brief} brief, ${AI_MODEL}, prompt ${PROMPT_VERSION}`);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: briefText(brief) }];
  const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let turns = 0;
  let queries = 0;
  let insights = 0;
  let stopReason = "unknown";
  let streamRetries = 0;

  const transcriptPath = path.resolve(process.cwd(), INGESTION.dataDir, "ai-runs", `${runId}.json`);
  const saveTranscript = async () => {
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await writeFile(transcriptPath, JSON.stringify({ runId, brief, model: AI_MODEL, promptVersion: PROMPT_VERSION, system, tools: toolDefs, messages, usage }, null, 1));
  };

  try {
    while (true) {
      if (turns >= AI_PARAMS.maxTurns) { stopReason = "turn_limit"; break; }
      if (costOf(usage) >= AI_PARAMS.maxCostUsd) { stopReason = "cost_limit"; break; }

      // The SDK retries failed requests, but not a stream that drops part-way through a response
      // (undici's "terminated"). The turn is only appended once complete, so re-sending the same
      // request is safe; the dropped attempt's tokens are billed but not counted in usage.
      let message: Anthropic.Message | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          message = await client.messages
            .stream({
              model: AI_MODEL,
              max_tokens: AI_PARAMS.maxTokensPerTurn,
              system,
              tools: toolDefs,
              messages,
              output_config: { effort: AI_PARAMS.effort },
              // Caches the growing conversation, so each turn re-reads the history at cache prices.
              cache_control: { type: "ephemeral" },
            })
            .finalMessage();
          break;
        } catch (error) {
          const transient = !(error instanceof Anthropic.APIError) || error.status === undefined || error.status >= 500 || error.status === 429;
          if (!transient || attempt >= AI_PARAMS.streamRetries) throw error;
          streamRetries++;
          log(`  turn ${turns + 1}: stream dropped (${error instanceof Error ? error.message : String(error)}), retry ${attempt + 1}`);
          await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
        }
      }
      turns++;
      usage.requests++;
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;

      if (message.stop_reason === "refusal") {
        throw new Error(`refused (${message.stop_details?.category ?? "no category"}) — no fallback model by design`);
      }
      // Append the assistant turn unchanged, thinking blocks included; history is never edited.
      messages.push({ role: "assistant", content: message.content });

      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) { stopReason = message.stop_reason ?? "end_turn"; break; }

      const content: (Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam)[] = [];
      for (const call of calls) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (message.stop_reason === "max_tokens") {
          content.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Your turn hit the output limit and this call may be truncated; send it again." });
          continue;
        }
        if (call.name === "run_sql") {
          if (typeof input.sql !== "string" || !input.sql.trim()) {
            content.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "sql is required" });
            continue;
          }
          const outcome = await runQuery(runId, input.sql);
          queries++;
          content.push({ type: "tool_result", tool_use_id: call.id, is_error: outcome.error !== null, content: formatForModel(outcome) });
        } else if (call.name === "record_insight") {
          const result = await validateInsight(runId, brief, input, regions);
          if (typeof result === "string") {
            content.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Not recorded: ${result}` });
          } else {
            await insertInsights(runId, [result]);
            insights++;
            content.push({ type: "tool_result", tool_use_id: call.id, content: `Recorded (${insights} so far).` });
          }
        } else {
          content.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Unknown tool ${call.name}` });
        }
      }

      const turnsLeft = AI_PARAMS.maxTurns - turns;
      const spent = costOf(usage);
      if (turnsLeft <= AI_PARAMS.warnTurnsLeft || spent >= AI_PARAMS.warnCostShare * AI_PARAMS.maxCostUsd) {
        content.push({
          type: "text",
          text: `Budget note: ${turnsLeft} turns left and about ${Math.round((spent / AI_PARAMS.maxCostUsd) * 100)}% of this run's budget used. Record your remaining insights now, then stop.`,
        });
      }
      messages.push({ role: "user", content });
      log(`  turn ${turns}: ${queries} queries, ${insights} insights, ~$${spent.toFixed(2)}`);
      if (turns % 5 === 0) await saveTranscript();
    }

    await saveTranscript();
    await finishRun(runId, { status: "done", usage: { ...usage, stopReason, turns, queries, insights, streamRetries, estimatedCostUsd: costOf(usage) }, temperature: null });
  } catch (error) {
    await saveTranscript().catch(() => {});
    await finishRun(runId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      usage: { ...usage, stopReason: "error", turns, queries, insights, streamRetries, estimatedCostUsd: costOf(usage) },
      temperature: null,
    });
    throw error;
  }

  return { runId, brief, turns, queries, insights, stopReason, usage, estimatedCostUsd: costOf(usage) };
}

/** Token count of a run's fixed opening — free to measure, the basis of the cost estimate. */
export async function measureOpening(brief: Brief): Promise<number> {
  const client = makeAnthropic();
  const { input_tokens } = await client.messages.countTokens({
    model: AI_MODEL,
    system: await systemPrompt(),
    tools: tools(brief),
    messages: [{ role: "user", content: briefText(brief) }],
  });
  return input_tokens;
}
