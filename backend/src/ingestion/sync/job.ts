import { HARVESTS, type HarvestDefinition } from "../config/harvests.ts";
import { INGESTION } from "../config/ingestion.ts";
import { adaptRun } from "../adapt.ts";
import { getSource } from "../sources/registry.ts";
import type { HarvestEvent } from "../sources/types.ts";
import { latestRunId, readManifest, readPageBody } from "../snapshot/store.ts";
import { classifyRun, makeClassifier } from "../text/job.ts";

/**
 * A sync: one press of the Run button.
 *
 * It harvests one window — a species, region and date range — from every source configured
 * for it, then adapts and keyword-classifies each new run so it is readable on every page the
 * moment it lands. The sources run side by side: the rate limit is per host, so running ALA
 * and iNaturalist together costs neither of them anything, and ALA dominates the time anyway.
 *
 * Underneath it is exactly the CLI's `harvest`, and each source still produces its own frozen
 * run — a sync groups runs, it does not replace them. What it adds is an event log the
 * dashboard can replay and follow, so a harvest can be watched while it happens.
 *
 * One sync at a time, held in memory. The job lives inside the server process, so a restart
 * — including `tsx watch` reloading on a saved backend file — ends it. Its partial runs never
 * get a manifest and are never offered to readers.
 */

export interface SyncWindow {
  key: string;
  label: string;
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  lanes: {
    harvestKey: string;
    source: string;
    label: string;
    lastRun: {
      runId: string;
      retrievedRecords: number;
      requestCount: number;
      durationMs: number;
      corpusHash: string;
      complete: boolean;
    } | null;
  }[];
}

/** What a sync adds around the harvest itself. */
export type SyncPayload =
  | HarvestEvent
  | { type: "job-started"; jobId: string; window: SyncWindow }
  | { type: "adapting" }
  | { type: "adapted"; recordsAdapted: number; recordsValid: number; duplicates: number }
  | { type: "classifying" }
  | { type: "classified"; labelled: number }
  | { type: "log"; message: string }
  | { type: "lane-finished" }
  | { type: "lane-failed"; message: string; cancelled: boolean }
  | { type: "job-finished"; status: SyncStatus };

/** `lane` is the harvest key an event belongs to, or null for the job as a whole. */
export type SyncEvent = { seq: number; at: string; lane: string | null } & SyncPayload;

export type SyncStatus = "running" | "finished" | "failed" | "cancelled";

interface SyncJob {
  id: string;
  window: SyncWindow;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Run id each lane is writing, known from its `started` event. */
  runIds: Map<string, string>;
  events: SyncEvent[];
  listeners: Set<(event: SyncEvent) => void>;
  controller: AbortController;
}

export class SyncConflictError extends Error {}

let current: SyncJob | null = null;

/** Harvests that share a species, region and window, keyed the same way the pages group them. */
const windowKeyOf = (h: HarvestDefinition) => `${h.speciesKey}-${h.regionKey}-${h.startDate}_${h.endDate}`;

const SOURCE_LABELS: Record<string, string> = { ala: "Atlas of Living Australia", inaturalist: "iNaturalist" };

function windowLabel(start: string, end: string): string {
  if (start.endsWith("-01-01") && end.endsWith("-12-31") && start.slice(0, 4) === end.slice(0, 4)) {
    return start.slice(0, 4);
  }
  return `${start} → ${end}`;
}

/** Every window the Run page can start, newest first, with what its last run cost. */
export async function listWindows(): Promise<SyncWindow[]> {
  const groups = new Map<string, HarvestDefinition[]>();
  for (const h of Object.values(HARVESTS)) {
    const key = windowKeyOf(h);
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }

  const windows = await Promise.all(
    [...groups.entries()].map(async ([key, harvests]) => {
      const first = harvests[0]!;
      const lanes = await Promise.all(
        harvests.map(async (h) => {
          const runId = await latestRunId(h.key);
          const m = runId ? await readManifest(h.key, runId) : null;
          return {
            harvestKey: h.key,
            source: h.source,
            label: SOURCE_LABELS[h.source] ?? h.source,
            lastRun: m && runId
              ? {
                  runId,
                  retrievedRecords: m.retrievedRecords,
                  requestCount: m.requestCount,
                  durationMs: m.durationMs,
                  corpusHash: m.corpusHash,
                  complete: m.complete,
                }
              : null,
          };
        }),
      );
      return {
        key,
        label: windowLabel(first.startDate, first.endDate),
        speciesKey: first.speciesKey,
        regionKey: first.regionKey,
        startDate: first.startDate,
        endDate: first.endDate,
        lanes,
      };
    }),
  );
  // Newest window first; a part-year window sits under the full year it belongs to.
  return windows.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate));
}

export function jobSummary(job: SyncJob | null = current) {
  if (!job) return null;
  return {
    id: job.id,
    window: job.window,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    events: job.events.length,
  };
}

export function getJob(id: string): SyncJob | null {
  return current?.id === id ? current : null;
}

function push(job: SyncJob, lane: string | null, payload: SyncPayload): void {
  const event = { seq: job.events.length, at: new Date().toISOString(), lane, ...payload } as SyncEvent;
  job.events.push(event);
  if (payload.type === "started") job.runIds.set(payload.harvestKey, payload.runId);
  for (const listener of job.listeners) listener(event);
}

/** Follow a job's events. Returns the unsubscribe. */
export function subscribe(job: SyncJob, listener: (event: SyncEvent) => void): () => void {
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

export async function startSync(windowKey: string) {
  if (current?.status === "running") {
    throw new SyncConflictError(`a sync is already running (${current.window.label}) — wait for it or cancel it`);
  }
  const window = (await listWindows()).find((w) => w.key === windowKey);
  if (!window) throw new Error(`unknown window "${windowKey}"`);

  const job: SyncJob = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    window,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runIds: new Map(),
    events: [],
    listeners: new Set(),
    controller: new AbortController(),
  };
  current = job;
  push(job, null, { type: "job-started", jobId: job.id, window });

  // Deliberately not awaited: the POST returns at once and the dashboard follows the events.
  void run(job);
  return jobSummary(job)!;
}

async function run(job: SyncJob): Promise<void> {
  const results = await Promise.allSettled(job.window.lanes.map((lane) => runLane(job, lane.harvestKey)));
  job.status = job.controller.signal.aborted
    ? "cancelled"
    : results.some((r) => r.status === "rejected")
      ? "failed"
      : "finished";
  job.finishedAt = new Date().toISOString();
  push(job, null, { type: "job-finished", status: job.status });
}

async function runLane(job: SyncJob, harvestKey: string): Promise<void> {
  const harvest = HARVESTS[harvestKey]!;
  const emit = (payload: SyncPayload) => push(job, harvestKey, payload);
  try {
    const { runId } = await getSource(harvest.source).harvest(harvest, {
      onEvent: emit,
      signal: job.controller.signal,
    });

    // The same two follow-on steps the CLI's `harvest` runs, so the new run reads on every page.
    emit({ type: "adapting" });
    const { summary } = await adaptRun(harvestKey, runId, {
      onProgress: (message) => emit({ type: "log", message: message.trim() }),
    });
    emit({
      type: "adapted",
      recordsAdapted: summary.recordsAdapted,
      recordsValid: summary.recordsValid,
      duplicates: summary.duplicates,
    });

    // The keyword baseline only: it is local and free. The model classifier costs money per
    // run and stays a deliberate CLI step.
    emit({ type: "classifying" });
    const classified = await classifyRun(harvestKey, runId, makeClassifier("keyword"));
    emit({ type: "classified", labelled: classified.items.length });

    emit({ type: "lane-finished" });
  } catch (error) {
    const cancelled = job.controller.signal.aborted;
    emit({
      type: "lane-failed",
      cancelled,
      message: cancelled ? "cancelled" : error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function cancelSync(id: string): boolean {
  const job = getJob(id);
  if (!job || job.status !== "running") return false;
  job.controller.abort();
  return true;
}

/**
 * One page a running sync has frozen, before its run has a manifest — the ordinary raw route
 * reads through the manifest, which is written last. Gated exactly as that route is.
 */
export async function getLivePage(id: string, harvestKey: string, file: string) {
  if (!INGESTION.serveRawResponses) return null;
  const job = getJob(id);
  const runId = job?.runIds.get(harvestKey);
  // Only pages this sync announced — a file name never reaches the disk unless it came from us.
  const announced = job?.events.some((e) => e.lane === harvestKey && e.type === "page" && e.page.file === file);
  if (!runId || !announced) return null;
  return { recordsKey: getSource(HARVESTS[harvestKey]!.source).recordsKey, body: await readPageBody(harvestKey, runId, file) };
}
