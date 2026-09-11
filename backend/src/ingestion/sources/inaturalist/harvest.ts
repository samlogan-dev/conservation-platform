import type { HarvestDefinition } from "../../config/harvests.ts";
import { REGIONS } from "../../config/regions.ts";
import { SPECIES } from "../../config/species.ts";
import { INGESTION } from "../../config/ingestion.ts";
import {
  SnapshotWriter,
  newRunId,
  type SnapshotManifest,
  type SnapshotSlice,
} from "../../snapshot/store.ts";
import { INAT_BASE_URL, INAT_MAX_PER_PAGE, countObservations, fetchPage, type InatQuery } from "./client.ts";
import type { HarvestOptions, HarvestResult } from "../types.ts";

/**
 * The iNaturalist harvest.
 *
 * Simpler than ALA's for one reason worth recording: there is no reachable-record cap to work
 * around. ALA silently truncates at 5,000 and forced the window to be partitioned into date
 * slices; iNaturalist pages by id cursor without limit. The single "slice" recorded below is
 * therefore the whole window — kept in the manifest's shape so both sources produce the same
 * reconciliation evidence, not because a partition was needed.
 *
 * What does *not* change is the discipline: count before paging, reconcile after, freeze every
 * response verbatim, and refuse to call the run complete unless the numbers balance.
 */
export async function runInaturalistHarvest(
  harvest: HarvestDefinition,
  options: HarvestOptions = {},
): Promise<HarvestResult> {
  const log = options.onProgress ?? (() => {});
  const species = SPECIES[harvest.speciesKey];
  const region = REGIONS[harvest.regionKey];
  if (!species) throw new Error(`unknown species key: ${harvest.speciesKey}`);
  if (!region) throw new Error(`unknown region key: ${harvest.regionKey}`);
  if (species.inatTaxonId === undefined) {
    throw new Error(`species "${species.key}" has no iNaturalist taxon id`);
  }

  const startedAt = new Date();
  const runId = newRunId();
  const warnings: string[] = [];
  let requestCount = 0;

  const query: InatQuery = {
    taxonId: species.inatTaxonId,
    placeId: region.inatPlaceId,
    d1: harvest.startDate,
    d2: harvest.endDate,
  };

  const writer = new SnapshotWriter(harvest.key, runId);
  await writer.init();

  log(`harvest ${harvest.key} (run ${runId})`);
  log(`  query: taxon_id=${query.taxonId} place_id=${query.placeId} ${query.d1}..${query.d2}`);

  const expectedTotal = await countObservations(query);
  requestCount++;
  log(`  window total: ${expectedTotal} observations`);

  const sliceKey = `${harvest.startDate}_${harvest.endDate}`;
  let cursor = 0;
  let retrieved = 0;
  let pages = 0;
  const seenIds = new Set<number>();

  // Bound the loop independently of the API's own signalling, so a source that kept returning
  // records could never spin here indefinitely.
  const maxPages = Math.ceil(expectedTotal / INAT_MAX_PER_PAGE) + 5;

  while (pages < maxPages) {
    const result = await fetchPage(query, cursor);
    requestCount++;

    const parsed = JSON.parse(result.body) as { results?: { id: number }[] };
    const records = parsed.results ?? [];
    if (records.length === 0) break;

    await writer.writePage(
      {
        sliceKey,
        // The cursor stands in for the offset — the manifest records where the page began,
        // whichever paging model the source uses.
        startIndex: cursor,
        pageSize: INAT_MAX_PER_PAGE,
        recordCount: records.length,
        url: result.url,
        status: result.status,
        fetchedAt: result.fetchedAt,
        durationMs: result.durationMs,
        attempts: result.attempts,
      },
      result.body,
    );

    for (const r of records) {
      if (seenIds.has(r.id)) {
        warnings.push(`observation ${r.id} returned more than once — cursor paging repeated a record`);
      }
      seenIds.add(r.id);
    }

    retrieved += records.length;
    pages++;
    cursor = records[records.length - 1]!.id;
    log(`  page ${pages}: ${records.length} records (cursor now ${cursor})`);
  }

  if (retrieved !== expectedTotal) {
    warnings.push(`expected ${expectedTotal} observations but retrieved ${retrieved}`);
  }
  if (seenIds.size !== retrieved) {
    warnings.push(`retrieved ${retrieved} records but only ${seenIds.size} distinct ids`);
  }

  const slices: SnapshotSlice[] = [
    {
      sliceKey,
      filters: [
        `taxon_id=${query.taxonId}`,
        `place_id=${query.placeId}`,
        `d1=${query.d1}`,
        `d2=${query.d2}`,
      ],
      expectedRecords: expectedTotal,
      retrievedRecords: retrieved,
      pages,
    },
  ];

  const finishedAt = new Date();
  const manifest: SnapshotManifest = {
    runId,
    harvestKey: harvest.key,
    description: harvest.description,
    source: "inaturalist",
    baseUrl: INAT_BASE_URL,
    query: {
      q: `taxon_id:${query.taxonId}`,
      fq: [`place_id:${query.placeId}`, `observed:[${query.d1} TO ${query.d2}]`],
    },
    // iNaturalist returns its whole record; there is no field-selection parameter to record.
    requestedFields: [],
    politeness: {
      userAgent: INGESTION.userAgent,
      minRequestIntervalMs: INGESTION.minRequestIntervalMs,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    expectedRecords: expectedTotal,
    retrievedRecords: retrieved,
    complete: warnings.length === 0 && retrieved === expectedTotal,
    slices,
    pages: writer.getPages(),
    corpusHash: writer.corpusHash(),
    requestCount,
    warnings,
  };

  await writer.writeManifest(manifest);
  log(
    `  done: ${retrieved}/${expectedTotal} records, ${requestCount} requests, ` +
      `corpus ${manifest.corpusHash.slice(0, 12)}, complete=${manifest.complete}`,
  );

  return { manifest, runId };
}
