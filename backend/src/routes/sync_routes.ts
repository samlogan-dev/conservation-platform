import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { INGESTION } from "../ingestion/config/ingestion.ts";
import {
  SyncConflictError,
  cancelSync,
  getJob,
  getLivePage,
  jobSummary,
  listWindows,
  startSync,
  subscribe,
  type SyncEvent,
} from "../ingestion/sync/job.ts";

/**
 * The Run page: start a harvest from the dashboard and watch it happen.
 *
 * This reverses an earlier rule that harvesting stays behind the CLI, and keeps the reasons
 * for it: a harvest only ever starts on an explicit POST, never on a page load; only one runs
 * at a time; and the whole surface is off unless INGESTION_ALLOW_UI_HARVEST permits it.
 */
export const syncRoutes = new Hono({ strict: false });

/** Seconds between keep-alive comments while a lane is waiting on a slow request. */
const HEARTBEAT_MS = 15_000;

syncRoutes.get("/", async (c) =>
  c.json({
    enabled: INGESTION.allowUiHarvest,
    minRequestIntervalMs: INGESTION.minRequestIntervalMs,
    windows: await listWindows(),
    job: jobSummary(),
  }),
);

syncRoutes.post("/", async (c) => {
  if (!INGESTION.allowUiHarvest) {
    throw new HTTPException(403, { message: "starting harvests from the dashboard is disabled (INGESTION_ALLOW_UI_HARVEST=false)" });
  }
  const { windowKey } = await c.req.json<{ windowKey?: string }>();
  if (!windowKey) throw new HTTPException(400, { message: "windowKey is required" });
  try {
    return c.json(await startSync(windowKey), 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HTTPException(error instanceof SyncConflictError ? 409 : 400, { message });
  }
});

/**
 * The job's events as server-sent events: everything so far, then live until it finishes.
 * Replaying from the start is what lets the page be closed and reopened mid-harvest; a
 * reconnecting EventSource sends Last-Event-ID and receives only what it missed.
 */
syncRoutes.get("/:jobId/events", (c) => {
  const job = getJob(c.req.param("jobId"));
  if (!job) throw new HTTPException(404, { message: "no such sync — the server may have restarted since it began" });

  const lastSeen = Number(c.req.header("Last-Event-ID") ?? -1);

  return streamSSE(c, async (stream) => {
    // Snapshot then subscribe with no await between, so no event falls in the gap.
    const pending: SyncEvent[] = job.events.filter((e) => e.seq > lastSeen);
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(job, (event) => {
      pending.push(event);
      wake?.();
    });
    stream.onAbort(() => {
      unsubscribe();
      wake?.();
    });

    try {
      while (!stream.aborted) {
        while (pending.length > 0) {
          const event = pending.shift()!;
          await stream.writeSSE({ id: String(event.seq), event: "sync", data: JSON.stringify(event) });
        }
        if (job.status !== "running") break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, HEARTBEAT_MS);
        });
        wake = null;
        if (pending.length === 0 && !stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
    } finally {
      unsubscribe();
    }
  });
});

syncRoutes.post("/:jobId/cancel", (c) => {
  if (!cancelSync(c.req.param("jobId"))) throw new HTTPException(404, { message: "no running sync with that id" });
  return c.json({ cancelling: true });
});

/** A page the running sync has just frozen — verbatim, gated like the ordinary raw route. */
syncRoutes.get("/:jobId/pages/:harvestKey/:file", async (c) => {
  const { jobId, harvestKey, file } = c.req.param();
  try {
    const result = await getLivePage(jobId, harvestKey, file);
    if (result) return c.json(result);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new HTTPException(404, {
    message: "page not available — no such page in this sync, or serving raw responses is disabled (INGESTION_SERVE_RAW=false)",
  });
});
