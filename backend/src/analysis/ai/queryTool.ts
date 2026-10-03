import { createHash } from "node:crypto";
import { aiReaderDb, db } from "../../db/pool.ts";

/**
 * The AI arm's only route to the data: one read-only SQL query per call, as the ai_reader role.
 *
 * The role already confines it (corpus schema only, no write privilege, 30 s default timeout —
 * db/migrations/004). This adds the layers a session could otherwise undo:
 *  - every query runs in its own READ ONLY transaction, so a session-level `SET` from an earlier
 *    call cannot carry over;
 *  - the statement timeout is set with SET LOCAL inside that transaction, overriding anything the
 *    session changed;
 *  - the query is sent through the extended protocol (a parameter array, even if empty), which
 *    refuses more than one statement — "SET statement_timeout = 0; SELECT …" cannot be smuggled in;
 *  - results are capped, by wrapping the query in a LIMIT, so a careless SELECT cannot pull two
 *    million rows into the model's context.
 *
 * Every call — including failures — is logged to analysis.ai_queries with a hash of its result,
 * so each insight can cite the queries behind it and the grounding check can re-run them.
 */
export const QUERY_LIMITS = {
  maxRows: 200,
  /** Characters of result text returned to the model; the full capped result is still hashed. */
  maxChars: 30_000,
  statementTimeoutMs: 30_000,
} as const;

export interface QueryOutcome {
  queryId: number;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  error: string | null;
  durationMs: number;
  resultHash: string | null;
}

/** Strip a trailing semicolon; the query is wrapped as a subquery. */
const normalise = (sql: string) => sql.trim().replace(/;\s*$/, "");

/**
 * sha256 of a result, independent of row order — a query without ORDER BY may return the same
 * rows in a different order on a re-run, and that is still the same result.
 */
export const hashResult = (columns: string[], rows: unknown[][]): string =>
  createHash("sha256").update(JSON.stringify({ columns, rows: rows.map((r) => JSON.stringify(r)).sort() })).digest("hex");

/** Run one query as ai_reader. Never throws for a bad query: the error is the result. */
export async function executeReadOnly(sql: string): Promise<Omit<QueryOutcome, "queryId">> {
  const wrapped = `select * from (${normalise(sql)}) as q limit ${QUERY_LIMITS.maxRows + 1}`;
  const client = await aiReaderDb().connect();
  const started = Date.now();
  try {
    await client.query("begin transaction read only");
    await client.query(`set local statement_timeout = ${QUERY_LIMITS.statementTimeoutMs}`);
    const res = await client.query({ text: wrapped, values: [], rowMode: "array" });
    await client.query("rollback");
    const columns = res.fields.map((f) => f.name);
    const all = res.rows as unknown[][];
    const truncated = all.length > QUERY_LIMITS.maxRows;
    const rows = truncated ? all.slice(0, QUERY_LIMITS.maxRows) : all;
    return {
      columns, rows, rowCount: rows.length, truncated, error: null,
      durationMs: Date.now() - started, resultHash: hashResult(columns, rows),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return {
      columns: [], rows: [], rowCount: 0, truncated: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started, resultHash: null,
    };
  } finally {
    client.release();
  }
}

/** Run and log a query for an AI run. */
export async function runQuery(runId: string, sql: string): Promise<QueryOutcome> {
  const outcome = await executeReadOnly(sql);
  const { rows } = await db().query<{ query_id: string }>(
    `insert into analysis.ai_queries (run_id, sql, row_count, truncated, result_hash, error, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7) returning query_id`,
    [runId, sql, outcome.rowCount, outcome.truncated, outcome.resultHash, outcome.error, outcome.durationMs],
  );
  return { queryId: Number(rows[0]!.query_id), ...outcome };
}

/** The result as the model sees it: compact, capped in characters, the cap stated. */
export function formatForModel(o: QueryOutcome): string {
  if (o.error) return JSON.stringify({ query_id: o.queryId, error: o.error });
  const header = { query_id: o.queryId, row_count: o.rowCount, truncated: o.truncated, columns: o.columns };
  let body = "";
  let shown = 0;
  for (const row of o.rows) {
    const line = JSON.stringify(row);
    if (body.length + line.length > QUERY_LIMITS.maxChars) break;
    body += line + "\n";
    shown++;
  }
  const note =
    shown < o.rowCount ? `\n(${o.rowCount - shown} more rows not shown — aggregate or narrow the query)` :
    o.truncated ? `\n(result capped at ${QUERY_LIMITS.maxRows} rows — aggregate or narrow the query)` : "";
  return `${JSON.stringify(header)}\n${body}${note}`;
}
