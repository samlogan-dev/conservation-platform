import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getTimeline, getWindowFamily, getWindowSynthesis, getWindowUnion, listScopes } from "../ingestion/portalService.ts";
import { SURFACES } from "../surfaces.ts";

/**
 * The practitioner portal's API. GET only, by construction: nothing here starts a harvest,
 * calls a model, or serves a raw response. Those live behind the console routes, which a
 * deployment can switch off without touching this file.
 *
 * Addressed by window (species, region, date range) rather than by run, because a reader asks
 * about a place and a period, not about a harvest. Every response still names its runs.
 */
export const portalRoutes = new Hono({ strict: false });

/** Unknown species, region or window is a 404, not a 500. */
async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^no (window|calendar-year)|has no adapted runs|^unknown harvest/.test(message)) {
      throw new HTTPException(404, { message });
    }
    throw error;
  }
}

/** What a reader can choose between, and whether the portal may link into the console. */
portalRoutes.get("/", async (c) => c.json({ consoleEnabled: SURFACES.consoleEnabled, scopes: await listScopes() }));

portalRoutes.get("/scopes/:speciesKey/:regionKey/timeline", async (c) => {
  const { speciesKey, regionKey } = c.req.param();
  return c.json(await orNotFound(() => getTimeline(speciesKey, regionKey)));
});

/** The window's sources as one de-duplicated corpus, split by record type. */
portalRoutes.get("/windows/:windowId/union", async (c) =>
  c.json(await orNotFound(() => getWindowUnion(c.req.param("windowId")))),
);

portalRoutes.get("/windows/:windowId/family", async (c) =>
  c.json(await orNotFound(() => getWindowFamily(c.req.param("windowId")))),
);

portalRoutes.get("/windows/:windowId/synthesis", async (c) =>
  c.json(await orNotFound(() => getWindowSynthesis(c.req.param("windowId")))),
);
