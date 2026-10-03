import type { HarvestDefinition } from "../../config/harvests.ts";
import { INGESTION } from "../../config/ingestion.ts";
import { politeDownload, politeFetch } from "../../http/politeClient.ts";
import { SnapshotWriter, newRunId, sha256, type SnapshotManifest } from "../../snapshot/store.ts";
import type { HarvestOptions, HarvestResult } from "../types.ts";
import { type AlaQuery, countRecords, eventDateFilter } from "./client.ts";
import { ALA_BASE_URL, ALA_DOWNLOAD_FIELDS } from "./fields.ts";
import { countDownloadRows } from "./downloadReader.ts";

/**
 * The ALA bulk download: one query of any size, delivered as a zip and frozen verbatim.
 *
 * Verified 3 Oct 2026: `/occurrences/offline/download` accepts the email of a registered ALA
 * account (an unregistered one gets a bare HTTP 400), queues the job, and returns a `statusUrl`
 * to poll; when finished, the status carries a `downloadUrl` for a zip holding `data.csv`,
 * `headings.csv` (column → requested field), `citation.csv` (per-dataset attribution) and a
 * README with the citation.
 *
 * The 5,000-record cap that shapes the paged harvester does not apply here, which is why the
 * corpus comes this way. What carries over is the discipline: count first, then reconcile what
 * arrived against the count, and only call the run complete if they agree.
 */

/** Download reason "scientific research" in ALA's logger vocabulary; "testing" for tests. */
const REASON_SCIENTIFIC_RESEARCH = "4";
const REASON_TESTING = "10";

/** Between status polls. A large download takes many minutes; polling faster helps no one. */
const POLL_INTERVAL_MS = 30_000;
/** Give up waiting after this long; the job may still finish and can be fetched by hand. */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

const ZIP_FILE = "download.zip";

interface DownloadStatus {
  status?: string;
  totalRecords?: number;
  statusUrl?: string;
  downloadUrl?: string;
  doi?: string;
  message?: string;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Responses are frozen into the manifest; make sure no email address rides along. */
const withoutEmail = (value: DownloadStatus): DownloadStatus =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !/email/i.test(k)));

export async function runAlaDownload(
  harvest: HarvestDefinition,
  options: HarvestOptions = {},
): Promise<HarvestResult> {
  if (harvest.source !== "ala-download") throw new Error(`runAlaDownload given a ${harvest.source} harvest`);
  const log = options.onProgress ?? (() => {});
  const email = process.env.ALA_DOWNLOAD_EMAIL?.trim();
  if (!email) {
    throw new Error("ALA bulk downloads need ALA_DOWNLOAD_EMAIL in backend/.env — the email of a registered ALA account");
  }

  const startedAt = new Date();
  const runId = newRunId();
  const warnings: string[] = [];
  let requestCount = 0;

  const query: AlaQuery = {
    q: "*:*",
    fq: [...harvest.filters, eventDateFilter(harvest.startDate, harvest.endDate)],
  };

  const writer = new SnapshotWriter(harvest.key, runId);
  await writer.init();
  log(`download ${harvest.key} (run ${runId})`);
  log(`  query: ${query.q} | ${query.fq.join(" | ")}`);

  const expectedRecords = await countRecords(query);
  requestCount++;
  log(`  expected: ${expectedRecords} records`);

  // --- Submit ---
  const params: Record<string, string> = {
    q: query.q,
    fields: ALA_DOWNLOAD_FIELDS.join(","),
    reasonTypeId: harvest.mintDoi ? REASON_SCIENTIFIC_RESEARCH : REASON_TESTING,
    fileType: "csv",
    emailNotify: "false",
    // Match the API's view of the data: the website's default quality filters would silently
    // drop records the paged harvester keeps.
    disableAllQualityFilters: "true",
    ...(harvest.mintDoi ? { mintDoi: "true" } : {}),
  };
  const submitUrl = new URL(`${ALA_BASE_URL}/occurrences/offline/download`);
  for (const [k, v] of Object.entries(params)) submitUrl.searchParams.set(k, v);
  for (const fq of query.fq) submitUrl.searchParams.append("fq", fq);
  submitUrl.searchParams.set("email", email);

  const submitted = await politeFetch(submitUrl.toString());
  requestCount++;
  const submitResponse = JSON.parse(submitted.body) as DownloadStatus;
  if (!submitResponse.statusUrl) {
    throw new Error(`download not accepted: ${submitted.body.slice(0, 300)}`);
  }
  log(`  submitted: ${submitResponse.status} (${submitResponse.totalRecords} records queued)`);

  // --- Poll ---
  let status: DownloadStatus = submitResponse;
  const waitStarted = Date.now();
  while (status.status !== "finished") {
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(`download ${status.status}: ${JSON.stringify(status).slice(0, 300)}`);
    }
    if (Date.now() - waitStarted > MAX_WAIT_MS) {
      throw new Error(`download still ${status.status} after ${MAX_WAIT_MS / 3_600_000}h — status: ${submitResponse.statusUrl}`);
    }
    options.signal?.throwIfAborted();
    await sleep(POLL_INTERVAL_MS);
    const polled = await politeFetch(submitResponse.statusUrl);
    requestCount++;
    status = JSON.parse(polled.body) as DownloadStatus;
    log(`  status: ${status.status}${status.records !== undefined ? ` (${status.records} written)` : ""}`);
  }
  if (!status.downloadUrl) throw new Error(`finished without a downloadUrl: ${JSON.stringify(status).slice(0, 300)}`);

  // --- Freeze the archive verbatim ---
  const file = await politeDownload(status.downloadUrl, writer.pagePath(ZIP_FILE));
  requestCount++;
  log(`  downloaded ${(file.bytes / 1e6).toFixed(1)} MB, sha256 ${file.contentHash.slice(0, 12)}`);

  const retrievedRecords = await countDownloadRows(writer.pagePath(ZIP_FILE));
  const queued = typeof status.totalRecords === "number" ? status.totalRecords : expectedRecords;
  if (retrievedRecords !== queued) {
    warnings.push(`archive holds ${retrievedRecords} rows but ALA queued ${queued}`);
  }
  if (queued !== expectedRecords) {
    // The corpus can move between the count and the job running; worth recording, not failing.
    warnings.push(`count was ${expectedRecords} at submission, ALA queued ${queued}`);
  }

  writer.addPage({
    file: ZIP_FILE,
    sliceKey: "all",
    startIndex: 0,
    pageSize: retrievedRecords,
    recordCount: retrievedRecords,
    url: status.downloadUrl,
    status: file.status,
    fetchedAt: file.fetchedAt,
    durationMs: file.durationMs,
    attempts: file.attempts,
    contentHash: file.contentHash,
    bytes: file.bytes,
  });

  const doi = typeof status.doi === "string" && status.doi ? status.doi : null;
  if (harvest.mintDoi && !doi) warnings.push("a DOI was requested but the final status carries none — check My downloads on ALA");

  const finishedAt = new Date();
  const manifest: SnapshotManifest = {
    runId,
    harvestKey: harvest.key,
    description: harvest.description,
    source: "ala-download",
    baseUrl: ALA_BASE_URL,
    query,
    requestedFields: [...ALA_DOWNLOAD_FIELDS],
    politeness: { userAgent: INGESTION.userAgent, minRequestIntervalMs: INGESTION.minRequestIntervalMs },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    expectedRecords,
    retrievedRecords,
    complete: retrievedRecords === queued,
    slices: [{ sliceKey: "all", filters: query.fq, expectedRecords: queued, retrievedRecords, pages: 1 }],
    pages: writer.getPages(),
    corpusHash: sha256(file.contentHash),
    requestCount,
    warnings,
    // The email is deliberately left out of what is frozen.
    download: { params, submitResponse: withoutEmail(submitResponse), finalStatus: withoutEmail(status), doi },
  };
  await writer.writeManifest(manifest);
  log(`  done: ${retrievedRecords}/${queued} rows, complete=${manifest.complete}${doi ? `, DOI ${doi}` : ""}`);
  return { manifest, runId };
}
