import { db } from "../db/pool.ts";
import { INGESTION } from "./config/ingestion.ts";
import { politeFetch } from "./http/politeClient.ts";
import { SnapshotWriter, latestRunId, newRunId, readManifest, readPageBody, type SnapshotManifest } from "./snapshot/store.ts";
import { ALA_BASE_URL } from "./sources/ala/fields.ts";
import { eventDateFilter } from "./sources/ala/client.ts";

/**
 * The effort denominator for reporting rates (insight #3): all-taxa record counts per 0.1° cell
 * per month, from ALA's `point-0.1` facet — aggregate queries, one per month, never harvested
 * records.
 *
 * "All taxa" is every record ALA holds in the cell and month, threatened or not, with the
 * telemetry datasets excluded (as `corpus.analysable_occurrences` excludes them), so numerator
 * and denominator are filtered alike. Monthly cells let any window be summed later.
 *
 * Each month's facet response is frozen verbatim like any other page, then loaded into
 * `corpus.effort_cells` in one transaction. A month is ~1.2 MB and ~12,000 cells (Oct 2024).
 */
export const EFFORT_HARVEST_KEY = "effort-point01-monthly";

/**
 * Taxonomic groups with their own effort counts, and the ALA filter for each (field names verified
 * against the live API, 4 Oct 2026). A threatened taxon's reporting rate is read against its own
 * group's effort; taxa in no group (fish, insects, …) use "all".
 */
export const EFFORT_GROUPS = {
  all: null,
  Aves: "class:Aves",
  Mammalia: "class:Mammalia",
  Reptilia: "class:Reptilia",
  Amphibia: "class:Amphibia",
  Plantae: "kingdom:Plantae",
} as const;
export type EffortGroup = keyof typeof EFFORT_GROUPS;

/** The snapshot key a group's facet responses are frozen under. */
export const effortHarvestKey = (group: EffortGroup) =>
  group === "all" ? EFFORT_HARVEST_KEY : `${EFFORT_HARVEST_KEY}-${group.toLowerCase()}`;

interface Month {
  key: string;
  start: string;
  end: string;
}

function months(from: string, to: string): Month[] {
  const out: Month[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ key: start.slice(0, 7), start, end });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * "lat,lon" as ALA labels a point-0.1 cell. Whole degrees lose their ".0", and zero is sometimes
 * signed: "-0,153.1" and "0,153.1" are the same cell (found in 6 of 141 months, all junk points on
 * the equator). Adding 0 normalises -0, and counts are summed per cell when loading.
 */
function parseCell(label: string): [number, number] | null {
  const [lat, lon] = label.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat! + 0, lon! + 0] : null;
}

interface FacetBody {
  totalRecords: number;
  facetResults?: { fieldName: string; fieldResult: { label: string; count: number }[] }[];
}
const cellsOf = (body: FacetBody) => body.facetResults?.find((f) => f.fieldName === "point-0.1")?.fieldResult ?? [];

export async function harvestEffort(
  from: string,
  to: string,
  options: { onProgress?: (message: string) => void; group?: EffortGroup } = {},
): Promise<{ harvestId: string; cells: number }> {
  const log = options.onProgress ?? (() => {});
  const group = options.group ?? "all";
  const harvestKey = effortHarvestKey(group);
  const groupFilter = EFFORT_GROUPS[group];
  const telemetry = (
    await db().query<{ uid: string }>("select data_resource_uid as uid from corpus.datasets where kind = 'telemetry' order by 1")
  ).rows.map((r) => r.uid);
  const exclude = [
    ...(telemetry.length ? [`-dataResourceUid:(${telemetry.join(" OR ")})`] : []),
    ...(groupFilter ? [groupFilter] : []),
  ];

  const runId = newRunId();
  const startedAt = new Date();
  const writer = new SnapshotWriter(harvestKey, runId);
  await writer.init();
  const span = months(from, to);
  let expected = 0;
  let retrieved = 0;
  const warnings: string[] = [];

  log(`effort (${group}) ${from} → ${to}: ${span.length} months, excluding ${telemetry.length} telemetry datasets`);
  for (const month of span) {
    const url = new URL(`${ALA_BASE_URL}/occurrences/search`);
    url.searchParams.set("q", "*:*");
    url.searchParams.set("pageSize", "0");
    for (const fq of [eventDateFilter(month.start, month.end), ...exclude]) url.searchParams.append("fq", fq);
    url.searchParams.set("facets", "point-0.1");
    url.searchParams.set("flimit", "-1");

    const result = await politeFetch(url.toString());
    const parsed = JSON.parse(result.body) as FacetBody;
    const cells = cellsOf(parsed);
    await writer.writePage(
      { sliceKey: month.key, startIndex: 0, pageSize: 0, recordCount: cells.length, url: result.url,
        status: result.status, fetchedAt: result.fetchedAt, durationMs: result.durationMs, attempts: result.attempts },
      result.body,
    );

    // ALA lists records without coordinates under a "Not supplied" bucket, which is no cell.
    let inCells = 0;
    let cellCount = 0;
    for (const c of cells) {
      const cell = parseCell(c.label);
      if (!cell) continue;
      inCells += c.count;
      cellCount++;
    }
    expected += parsed.totalRecords;
    retrieved += inCells;
    // Records without coordinates fall outside every cell; worth knowing how many.
    if (inCells !== parsed.totalRecords) {
      warnings.push(`${month.key}: ${parsed.totalRecords - inCells} of ${parsed.totalRecords} records in no cell`);
    }
    log(`  ${month.key}: ${cellCount} cells, ${parsed.totalRecords} records`);
  }

  const finishedAt = new Date();
  const manifest: SnapshotManifest = {
    runId,
    harvestKey,
    description: `${group === "all" ? "All-taxa" : group} records per 0.1° cell per month, telemetry excluded, ${from} to ${to}, via ALA facets`,
    source: "ala-facets",
    baseUrl: ALA_BASE_URL,
    query: { q: "*:*", fq: exclude },
    requestedFields: ["point-0.1"],
    politeness: { userAgent: INGESTION.userAgent, minRequestIntervalMs: INGESTION.minRequestIntervalMs },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    expectedRecords: expected,
    retrievedRecords: retrieved,
    complete: true,
    slices: span.map((m) => ({ sliceKey: m.key, filters: [eventDateFilter(m.start, m.end), ...exclude], expectedRecords: 0, retrievedRecords: 0, pages: 1 })),
    pages: writer.getPages(),
    corpusHash: writer.corpusHash(),
    requestCount: span.length,
    warnings,
  };
  await writer.writeManifest(manifest);

  return loadEffort(runId, { onProgress: log, group });
}

/**
 * Load a frozen effort run into `corpus.effort_cells`, in one transaction. Reads only the frozen
 * pages, so a failed load is retried without touching ALA.
 */
export async function loadEffort(
  runId?: string,
  options: { onProgress?: (message: string) => void; group?: EffortGroup } = {},
): Promise<{ harvestId: string; cells: number }> {
  const log = options.onProgress ?? (() => {});
  const group = options.group ?? "all";
  const harvestKey = effortHarvestKey(group);
  const resolved = runId ?? (await latestRunId(harvestKey));
  if (!resolved) throw new Error(`no frozen effort run for ${group} — run: npm run ingest -- effort --group=${group}`);
  const manifest = await readManifest(harvestKey, resolved);
  const harvestId = `${harvestKey}/${resolved}`;

  // Sum per cell and month: labels that differ only in a signed zero are one cell.
  const totals = new Map<string, { lat: number; lon: number; start: string; end: string; records: number }>();
  for (const page of manifest.pages) {
    const start = `${page.sliceKey}-01`;
    const [y, m] = page.sliceKey.split("-").map(Number) as [number, number];
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const body = JSON.parse(await readPageBody(harvestKey, resolved, page.file)) as FacetBody;
    for (const c of cellsOf(body)) {
      const cell = parseCell(c.label);
      if (!cell) continue;
      const key = `${cell[0]},${cell[1]},${start}`;
      const t = totals.get(key) ?? { lat: cell[0], lon: cell[1], start, end, records: 0 };
      t.records += c.count;
      totals.set(key, t);
    }
  }
  const rows = [...totals.values()];

  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into corpus.harvest_runs (harvest_id, harvest_key, run_id, source, description, query, started_at,
         finished_at, expected_records, retrieved_records, complete, corpus_hash, request_count, warnings)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (harvest_id) do update set loaded_at = now()`,
      [harvestId, harvestKey, resolved, manifest.source, manifest.description, JSON.stringify(manifest.query),
        manifest.startedAt, manifest.finishedAt, manifest.expectedRecords, manifest.retrievedRecords, manifest.complete,
        manifest.corpusHash, manifest.requestCount, JSON.stringify(manifest.warnings)],
    );
    for (let i = 0; i < rows.length; i += 5_000) {
      await client.query(
        `insert into corpus.effort_cells (taxon_group, cell_lat, cell_lon, period_start, period_end, records, harvest_id)
         select $3, x.lat, x.lon, x.start, x."end", x.records, $2
         from jsonb_to_recordset($1::jsonb) as x(lat numeric, lon numeric, start date, "end" date, records integer)
         on conflict (taxon_group, cell_lat, cell_lon, period_start, period_end)
         do update set records = excluded.records, harvest_id = excluded.harvest_id`,
        [JSON.stringify(rows.slice(i, i + 5_000)), harvestId, group],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  log(`loaded ${rows.length} ${group} cell-months (${manifest.retrievedRecords} of ${manifest.expectedRecords} records fall in a cell)`);
  return { harvestId, cells: rows.length };
}
