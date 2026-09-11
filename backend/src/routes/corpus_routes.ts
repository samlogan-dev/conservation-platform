import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  getAnalysis,
  getManifest,
  getComparisons,
  getFamily,
  getRawPage,
  getRecordDetail,
  getSchema,
  getTextOverview,
  listHarvests,
  listPages,
  listRecords,
  listTextRows,
  resolveRunId,
} from "../ingestion/corpusService.ts";

/**
 * Read-only API over harvested runs.
 *
 * Harvesting is deliberately not exposed over HTTP — it is a batch job with a rate-limited
 * network footprint against someone else's service, and it belongs behind the CLI where it
 * cannot be triggered by a page refresh.
 */
export const corpusRoutes = new Hono({ strict: false });

const intParam = (value: string | undefined, fallback: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
};

/** Turn a "no snapshots" error into a 404 rather than a 500. */
async function withRun<T>(
  harvestKey: string,
  runIdParam: string | undefined,
  fn: (runId: string) => Promise<T>,
): Promise<T> {
  let runId: string;
  try {
    runId = await resolveRunId(harvestKey, runIdParam);
  } catch (error) {
    throw new HTTPException(404, {
      message: error instanceof Error ? error.message : "run not found",
    });
  }
  try {
    return await fn(runId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HTTPException(404, {
        message: `run "${runId}" has no adapted records — run: npm run ingest -- adapt ${harvestKey} ${runId}`,
      });
    }
    throw error;
  }
}

corpusRoutes.get("/harvests", async (c) => c.json(await listHarvests()));

corpusRoutes.get("/:harvestKey/:runId/manifest", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getManifest(harvestKey, r)));
});

corpusRoutes.get("/:harvestKey/:runId/analysis", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getAnalysis(harvestKey, r)));
});

corpusRoutes.get("/:harvestKey/:runId/pages", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => listPages(harvestKey, r)));
});

/** One frozen response verbatim — see getRawPage for why this one is not redacted. */
corpusRoutes.get("/:harvestKey/:runId/pages/:file", async (c) => {
  const { harvestKey, runId, file } = c.req.param();
  const result = await withRun(harvestKey, runId, (r) => getRawPage(harvestKey, r, file));
  if (!result) {
    throw new HTTPException(404, {
      message:
        "raw response not available — either no such page, or serving raw responses is disabled (INGESTION_SERVE_RAW=false)",
    });
  }
  return c.json(result);
});

corpusRoutes.get("/:harvestKey/:runId/comparison", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getComparisons(harvestKey, r)));
});

corpusRoutes.get("/:harvestKey/:runId/family", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getFamily(harvestKey, r)));
});

corpusRoutes.get("/:harvestKey/:runId/schema", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getSchema(harvestKey, r)));
});

/** What the free text says: the taxonomy and one summary per classifier that has run. */
corpusRoutes.get("/:harvestKey/:runId/text", async (c) => {
  const { harvestKey, runId } = c.req.param();
  return c.json(await withRun(harvestKey, runId, (r) => getTextOverview(harvestKey, r)));
});

corpusRoutes.get("/:harvestKey/:runId/text/rows", async (c) => {
  const { harvestKey, runId } = c.req.param();
  const q = c.req.query();
  const classifier = q["classifier"];
  return c.json(
    await withRun(harvestKey, runId, (r) =>
      listTextRows(harvestKey, r, {
        classifier: classifier === "llm" || classifier === "keyword" ? classifier : undefined,
        limit: intParam(q["limit"], 100, 500),
        offset: intParam(q["offset"], 0, Number.MAX_SAFE_INTEGER),
        subject: q["subject"] ?? undefined,
        condition: q["condition"] ?? undefined,
        event: q["event"] ?? undefined,
      }),
    ),
  );
});

corpusRoutes.get("/:harvestKey/:runId/records", async (c) => {
  const { harvestKey, runId } = c.req.param();
  const q = c.req.query();
  return c.json(
    await withRun(harvestKey, runId, (r) =>
      listRecords(harvestKey, r, {
        limit: intParam(q["limit"], 50, 500),
        offset: intParam(q["offset"], 0, Number.MAX_SAFE_INTEGER),
        search: q["search"] ?? undefined,
        dataResourceUid: q["dataResourceUid"] ?? undefined,
        withText: q["withText"] === "true",
        invalidOnly: q["invalidOnly"] === "true",
      }),
    ),
  );
});

corpusRoutes.get("/:harvestKey/:runId/records/:recordId{.+}", async (c) => {
  const { harvestKey, runId, recordId } = c.req.param();
  const detail = await withRun(harvestKey, runId, (r) =>
    getRecordDetail(harvestKey, r, decodeURIComponent(recordId)),
  );
  if (!detail) throw new HTTPException(404, { message: `no record ${recordId}` });
  return c.json(detail);
});
