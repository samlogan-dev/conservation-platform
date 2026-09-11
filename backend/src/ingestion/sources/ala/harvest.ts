import type { HarvestDefinition } from "../../config/harvests.ts";
import { REGIONS } from "../../config/regions.ts";
import { SPECIES } from "../../config/species.ts";
import type { HarvestOptions, HarvestResult } from "../types.ts";
import { INGESTION } from "../../config/ingestion.ts";
import {
  SnapshotWriter,
  newRunId,
  type SnapshotManifest,
  type SnapshotSlice,
} from "../../snapshot/store.ts";
import {
  type AlaQuery,
  countRecords,
  eventDateFilter,
  fetchPage,
  stateFilter,
} from "./client.ts";
import { ALA_BASE_URL, ALA_MAX_PAGE_SIZE, ALA_MAX_REACHABLE_OFFSET, ALA_REQUESTED_FIELDS } from "./fields.ts";

/**
 * The ALA harvest.
 *
 * The constraint this is built around, measured against the live API on 29 Aug 2026:
 *
 *   Only the first 5000 records of any ALA query are reachable. `startIndex + pageSize` above
 *   5000 does not return an error — it returns HTTP 200 with an empty `occurrences` array.
 *
 * That is a silent-truncation trap. A harvester that simply pages until it gets an empty page
 * would stop at 5000 records, report success, and quietly capture 3% of a 162,000-record
 * query. Nothing in the response says anything is missing.
 *
 * So the window is *partitioned* into slices each provably under the cap, every slice is
 * counted before it is paged, and the count is reconciled against what paging actually
 * returned. `complete` on the manifest is only true when every slice balanced.
 */

/** Safety margin under the hard cap: the corpus can grow between counting and paging. */
const SLICE_LIMIT = 4_500;

interface DateSlice {
  key: string;
  startDate: string;
  endDate: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** Calendar-month slices spanning the window; the first partition attempted. */
function sliceByMonth(startDate: string, endDate: string): DateSlice[] {
  const slices: DateSlice[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  let cursor = new Date(`${startDate}T00:00:00Z`);

  while (cursor <= end) {
    const monthEnd = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    );
    const sliceEnd = monthEnd > end ? end : monthEnd;
    slices.push({
      key: `${iso(cursor)}_${iso(sliceEnd)}`,
      startDate: iso(cursor),
      endDate: iso(sliceEnd),
    });
    cursor = addDays(sliceEnd, 1);
  }
  return slices;
}

/** Halve a slice by date. Returns null when the slice is already a single day. */
function bisect(slice: DateSlice): [DateSlice, DateSlice] | null {
  const start = new Date(`${slice.startDate}T00:00:00Z`);
  const end = new Date(`${slice.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days < 1) return null;

  const midEnd = addDays(start, Math.floor(days / 2));
  const midStart = addDays(midEnd, 1);
  return [
    { key: `${iso(start)}_${iso(midEnd)}`, startDate: iso(start), endDate: iso(midEnd) },
    { key: `${iso(midStart)}_${iso(end)}`, startDate: iso(midStart), endDate: iso(end) },
  ];
}

export async function runAlaHarvest(
  harvest: HarvestDefinition,
  options: HarvestOptions = {},
): Promise<HarvestResult> {
  const log = options.onProgress ?? (() => {});
  const species = SPECIES[harvest.speciesKey];
  const region = REGIONS[harvest.regionKey];
  if (!species) throw new Error(`unknown species key: ${harvest.speciesKey}`);
  if (!region) throw new Error(`unknown region key: ${harvest.regionKey}`);

  const startedAt = new Date();
  const runId = newRunId();
  const warnings: string[] = [];
  let requestCount = 0;

  const baseQuery: AlaQuery = {
    q: `taxon_name:"${species.alaTaxonName}"`,
    fq: [
      stateFilter(region.alaStateProvince),
      eventDateFilter(harvest.startDate, harvest.endDate),
    ],
  };

  const writer = new SnapshotWriter(harvest.key, runId);
  await writer.init();

  log(`harvest ${harvest.key} (run ${runId})`);
  log(`  query: ${baseQuery.q} | ${baseQuery.fq.join(" | ")}`);

  const expectedTotal = await countRecords(baseQuery);
  requestCount++;
  log(`  window total: ${expectedTotal} records`);

  // --- Partition until every slice is provably under the reachable cap ---
  const queue = sliceByMonth(harvest.startDate, harvest.endDate);
  const planned: (DateSlice & { count: number })[] = [];

  while (queue.length > 0) {
    const slice = queue.shift()!;
    const sliceQuery: AlaQuery = {
      q: baseQuery.q,
      fq: [stateFilter(region.alaStateProvince), eventDateFilter(slice.startDate, slice.endDate)],
    };
    const count = await countRecords(sliceQuery);
    requestCount++;

    if (count > SLICE_LIMIT) {
      const halves = bisect(slice);
      if (halves) {
        log(`  slice ${slice.key}: ${count} over limit — splitting`);
        queue.unshift(...halves);
        continue;
      }
      // A single day over the cap cannot be split further by date. The next partition key
      // would be dataResourceUid; until that exists, refuse to pretend the slice is complete.
      warnings.push(
        `slice ${slice.key} holds ${count} records, above the ${ALA_MAX_REACHABLE_OFFSET} ` +
          `reachable-record cap, and is a single day so it cannot be split further by date. ` +
          `Records beyond the cap are unreachable and this run is incomplete.`,
      );
    }
    if (count > 0) planned.push({ ...slice, count });
  }

  log(`  partitioned into ${planned.length} slices`);

  // --- Page each slice, freezing every raw response ---
  const slices: SnapshotSlice[] = [];
  let retrievedTotal = 0;

  for (const slice of planned) {
    const filters = [
      stateFilter(region.alaStateProvince),
      eventDateFilter(slice.startDate, slice.endDate),
    ];
    const sliceQuery: AlaQuery = { q: baseQuery.q, fq: filters };

    // Never ask for an offset the API cannot serve; it would answer 200-with-nothing.
    const reachable = Math.min(slice.count, ALA_MAX_REACHABLE_OFFSET);
    let retrieved = 0;
    let pages = 0;

    for (let startIndex = 0; startIndex < reachable; startIndex += ALA_MAX_PAGE_SIZE) {
      const pageSize = Math.min(ALA_MAX_PAGE_SIZE, ALA_MAX_REACHABLE_OFFSET - startIndex);
      const result = await fetchPage(sliceQuery, startIndex, pageSize);
      requestCount++;

      // Count records off the raw body without keeping the parse — the body is what is frozen.
      const parsed = JSON.parse(result.body) as { occurrences?: unknown[] };
      const recordCount = parsed.occurrences?.length ?? 0;

      await writer.writePage(
        {
          sliceKey: slice.key,
          startIndex,
          pageSize,
          recordCount,
          url: result.url,
          status: result.status,
          fetchedAt: result.fetchedAt,
          durationMs: result.durationMs,
          attempts: result.attempts,
        },
        result.body,
      );

      retrieved += recordCount;
      pages++;

      // An empty page before the expected end is the truncation signature. Stop paging this
      // slice rather than looping to the cap on empty responses.
      if (recordCount === 0) {
        if (retrieved < slice.count) {
          warnings.push(
            `slice ${slice.key} returned an empty page at startIndex ${startIndex} after ` +
              `${retrieved} of an expected ${slice.count} records`,
          );
        }
        break;
      }
    }

    if (retrieved !== slice.count) {
      warnings.push(
        `slice ${slice.key} expected ${slice.count} records but retrieved ${retrieved}`,
      );
    }

    slices.push({
      sliceKey: slice.key,
      filters,
      expectedRecords: slice.count,
      retrievedRecords: retrieved,
      pages,
    });
    retrievedTotal += retrieved;
    log(`  slice ${slice.key}: ${retrieved}/${slice.count} in ${pages} page(s)`);
  }

  const finishedAt = new Date();
  const complete =
    warnings.length === 0 && slices.every((s) => s.retrievedRecords === s.expectedRecords);

  const manifest: SnapshotManifest = {
    runId,
    harvestKey: harvest.key,
    description: harvest.description,
    source: "ala",
    baseUrl: ALA_BASE_URL,
    query: baseQuery,
    requestedFields: [...ALA_REQUESTED_FIELDS],
    politeness: {
      userAgent: INGESTION.userAgent,
      minRequestIntervalMs: INGESTION.minRequestIntervalMs,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    expectedRecords: expectedTotal,
    retrievedRecords: retrievedTotal,
    complete,
    slices,
    pages: writer.getPages(),
    corpusHash: writer.corpusHash(),
    requestCount,
    warnings,
  };

  await writer.writeManifest(manifest);
  log(
    `  done: ${retrievedTotal}/${expectedTotal} records, ${requestCount} requests, ` +
      `corpus ${manifest.corpusHash.slice(0, 12)}, complete=${complete}`,
  );

  return { manifest, runId };
}
