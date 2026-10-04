import { db } from "../db/pool.ts";
import { INGESTION } from "./config/ingestion.ts";
import { politeFetch } from "./http/politeClient.ts";
import { SnapshotWriter, latestRunId, newRunId, readManifest, readPageBody, type SnapshotManifest } from "./snapshot/store.ts";

/**
 * IBRA 7 bioregion outlines, for maps only: ALA's spatial layer cl1048, the layer ALA intersects
 * every record with, so a region's name here is exactly the `ibra_region` on its records.
 *
 * One request lists the layer's objects; one per region fetches its full-resolution WKT
 * (~5 MB for the Wet Tropics — the service offers no simplified form). Every body is frozen
 * verbatim, then loaded simplified to ~0.01° in one transaction.
 */
export const REGIONS_HARVEST_KEY = "ibra7-regions";
const SPATIAL_BASE_URL = "https://spatial.ala.org.au/ws";
const LAYER = "cl1048";
/** Simplification tolerance in degrees: ~1 km, below a pixel on a national map. */
const TOLERANCE = 0.01;

interface LayerObject {
  pid: string;
  name: string;
  area_km: number;
}

export async function harvestRegions(
  options: { onProgress?: (message: string) => void } = {},
): Promise<{ harvestId: string; regions: number }> {
  const log = options.onProgress ?? (() => {});
  const runId = newRunId();
  const startedAt = new Date();
  const writer = new SnapshotWriter(REGIONS_HARVEST_KEY, runId);
  await writer.init();

  const page = (sliceKey: string, r: Awaited<ReturnType<typeof politeFetch>>, recordCount: number) =>
    writer.writePage(
      { sliceKey, startIndex: 0, pageSize: 0, recordCount, url: r.url, status: r.status, fetchedAt: r.fetchedAt,
        durationMs: r.durationMs, attempts: r.attempts },
      r.body,
    );

  const list = await politeFetch(`${SPATIAL_BASE_URL}/objects/${LAYER}`);
  const objects = JSON.parse(list.body) as LayerObject[];
  await page("objects", list, objects.length);
  log(`${LAYER}: ${objects.length} regions`);

  for (const [i, o] of objects.entries()) {
    const r = await politeFetch(`${SPATIAL_BASE_URL}/shapes/wkt/${o.pid}`);
    await page(`wkt-${o.pid}`, r, 1);
    log(`  ${i + 1}/${objects.length} ${o.name} (${(r.body.length / 1e6).toFixed(1)} MB)`);
  }

  const finishedAt = new Date();
  const manifest: SnapshotManifest = {
    runId,
    harvestKey: REGIONS_HARVEST_KEY,
    description: `IBRA 7 region outlines (ALA spatial layer ${LAYER}), full-resolution WKT`,
    source: "ala-spatial",
    baseUrl: SPATIAL_BASE_URL,
    query: { q: LAYER, fq: [] },
    requestedFields: ["wkt"],
    politeness: { userAgent: INGESTION.userAgent, minRequestIntervalMs: INGESTION.minRequestIntervalMs },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    expectedRecords: objects.length,
    retrievedRecords: objects.length,
    complete: true,
    slices: [],
    pages: writer.getPages(),
    corpusHash: writer.corpusHash(),
    requestCount: objects.length + 1,
    warnings: [],
  };
  await writer.writeManifest(manifest);
  return loadRegions(runId, { onProgress: log });
}

/** Load a frozen run into `corpus.ibra_regions`, simplified, replacing what was there. No network. */
export async function loadRegions(
  runId?: string,
  options: { onProgress?: (message: string) => void } = {},
): Promise<{ harvestId: string; regions: number }> {
  const log = options.onProgress ?? (() => {});
  const resolved = runId ?? (await latestRunId(REGIONS_HARVEST_KEY));
  if (!resolved) throw new Error("no frozen region run — run: npm run ingest -- regions");
  const manifest = await readManifest(REGIONS_HARVEST_KEY, resolved);
  const harvestId = `${REGIONS_HARVEST_KEY}/${resolved}`;
  const listPage = manifest.pages.find((p) => p.sliceKey === "objects");
  if (!listPage) throw new Error("region run has no object list");
  const objects = JSON.parse(await readPageBody(REGIONS_HARVEST_KEY, resolved, listPage.file)) as LayerObject[];

  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into corpus.harvest_runs (harvest_id, harvest_key, run_id, source, description, query, started_at,
         finished_at, expected_records, retrieved_records, complete, corpus_hash, request_count, warnings)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (harvest_id) do update set loaded_at = now()`,
      [harvestId, REGIONS_HARVEST_KEY, resolved, manifest.source, manifest.description, JSON.stringify(manifest.query),
        manifest.startedAt, manifest.finishedAt, manifest.expectedRecords, manifest.retrievedRecords, manifest.complete,
        manifest.corpusHash, manifest.requestCount, JSON.stringify(manifest.warnings)],
    );
    await client.query("delete from corpus.ibra_regions");
    for (const o of objects) {
      const p = manifest.pages.find((x) => x.sliceKey === `wkt-${o.pid}`);
      if (!p) throw new Error(`no geometry frozen for ${o.name}`);
      const wkt = await readPageBody(REGIONS_HARVEST_KEY, resolved, p.file);
      await client.query(
        `insert into corpus.ibra_regions (name, pid, area_km2, geom, harvest_id)
         values ($1, $2, $3, st_multi(st_collectionextract(st_makevalid(
           st_simplifypreservetopology(st_geomfromtext($4, 4326), $5)), 3)), $6)`,
        [o.name, o.pid, o.area_km, wkt, TOLERANCE, harvestId],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  log(`loaded ${objects.length} region outlines`);
  return { harvestId, regions: objects.length };
}
