import type pg from "pg";
import { db } from "../db/pool.ts";

/**
 * Bookkeeping shared by both arms: opening a run, recording exactly which corpus it read, writing
 * insights in the shared shape, and closing the run.
 */

export type InsightType =
  | "silent_species"
  | "range_change"
  | "reporting_rate"
  | "co_movement"
  | "notable_record"
  | "other";

/** The shared insight record (analysis.insights), as either arm produces it. */
export interface Insight {
  insightType: InsightType;
  taxonConceptId: string | null;
  region: string | null;
  periodStart: string;
  periodEnd: string;
  figures: Record<string, unknown>;
  confidence: Record<string, unknown>;
  summary: string;
  queryIds?: number[];
}

/** The harvest runs loaded right now — what a run reads, recorded so it can be reproduced. */
async function corpusDescription(client: pg.PoolClient | pg.Pool): Promise<unknown> {
  const { rows } = await client.query(
    `select harvest_id, source, corpus_hash, retrieved_records, complete, loaded_at
     from corpus.harvest_runs order by harvest_id`,
  );
  return rows;
}

export async function startRun(args: {
  arm: "calculated" | "ai";
  brief?: "guided" | "open";
  params: unknown;
  model?: string;
  promptVersion?: string;
}): Promise<string> {
  const corpus = await corpusDescription(db());
  const { rows } = await db().query<{ run_id: string }>(
    `insert into analysis.runs (arm, brief, corpus, params, model, prompt_version)
     values ($1, $2, $3, $4, $5, $6) returning run_id`,
    [args.arm, args.brief ?? null, JSON.stringify(corpus), JSON.stringify(args.params), args.model ?? null, args.promptVersion ?? null],
  );
  return rows[0]!.run_id;
}

export async function finishRun(
  runId: string,
  outcome: { status: "done" | "failed"; error?: string; usage?: unknown; temperature?: number | null },
): Promise<void> {
  await db().query(
    `update analysis.runs
     set status = $2, error = $3, usage = $4, temperature = $5, finished_at = now()
     where run_id = $1`,
    [runId, outcome.status, outcome.error ?? null, outcome.usage ? JSON.stringify(outcome.usage) : null, outcome.temperature ?? null],
  );
}

export async function insertInsights(runId: string, insights: Insight[]): Promise<void> {
  for (let i = 0; i < insights.length; i += 1_000) {
    const batch = insights.slice(i, i + 1_000).map((x) => ({
      insight_type: x.insightType,
      taxon_concept_id: x.taxonConceptId,
      region: x.region,
      period_start: x.periodStart,
      period_end: x.periodEnd,
      figures: x.figures,
      confidence: x.confidence,
      summary: x.summary,
      query_ids: x.queryIds ?? [],
    }));
    await db().query(
      `insert into analysis.insights
         (run_id, insight_type, taxon_concept_id, region, period_start, period_end, figures, confidence, summary, query_ids)
       select $2, x.insight_type, x.taxon_concept_id, x.region, x.period_start, x.period_end, x.figures, x.confidence,
              x.summary, x.query_ids
       from jsonb_to_recordset($1::jsonb) as x(
         insight_type text, taxon_concept_id text, region text, period_start date, period_end date,
         figures jsonb, confidence jsonb, summary text, query_ids bigint[])`,
      [JSON.stringify(batch), runId],
    );
  }
}

/** A taxon's display name: common name with the scientific name, or the scientific name alone. */
export const taxonLabel = (vernacular: string | null, scientific: string | null): string =>
  vernacular ? `${vernacular} (${scientific})` : (scientific ?? "unnamed taxon");
