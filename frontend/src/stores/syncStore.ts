import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { cancelSyncAPI, getSyncStateAPI, startSyncAPI, syncEventsURL } from "@/apis/syncAPI";
import type { SnapshotPageMeta } from "@/apis/corpusTypes";
import type { SyncEvent, SyncJobSummary, SyncLastRun, SyncStatus, SyncWindow } from "@/apis/syncTypes";
import { useCorpusStore } from "./corpusStore";

/**
 * The Run page's state: the windows that can be harvested, and the sync in progress, folded
 * from its event stream into one lane per source.
 *
 * The backend replays a job's events from the start on connect, so the lanes are always
 * rebuilt from the log rather than trusted from memory — reopening the tab mid-harvest lands
 * on the same picture as watching it from the beginning.
 */

export type LanePhase = "waiting" | "counting" | "paging" | "adapting" | "classifying" | "done" | "failed" | "cancelled";

export type SliceState = "planned" | "paging" | "done" | "mismatch" | "empty";

export interface SliceProgress {
  sliceKey: string;
  expected: number;
  retrieved: number;
  pages: number;
  state: SliceState;
}

export interface LaneState {
  harvestKey: string;
  source: string;
  label: string;
  /** The run before this one, for the "since last run" comparison. */
  previous: SyncLastRun | null;
  runId: string | null;
  phase: LanePhase;
  expected: number | null;
  retrieved: number;
  bytes: number;
  slices: SliceProgress[];
  splits: { sliceKey: string; expected: number; into: [string, string] }[];
  /** Newest first. */
  calls: SnapshotPageMeta[];
  harvested: Extract<SyncEvent, { type: "harvested" }> | null;
  adapted: Extract<SyncEvent, { type: "adapted" }> | null;
  labelled: number | null;
  lastLog: string | null;
  error: string | null;
}

function emptyLane(lane: SyncWindow["lanes"][number]): LaneState {
  return {
    harvestKey: lane.harvestKey,
    source: lane.source,
    label: lane.label,
    previous: lane.lastRun,
    runId: null,
    phase: "waiting",
    expected: null,
    retrieved: 0,
    bytes: 0,
    slices: [],
    splits: [],
    calls: [],
    harvested: null,
    adapted: null,
    labelled: null,
    lastLog: null,
    error: null,
  };
}

export const useSyncStore = defineStore("syncStore", () => {
  const enabled = ref(false);
  const minRequestIntervalMs = ref(1100);
  const windows = ref<SyncWindow[]>([]);
  const job = ref<SyncJobSummary | null>(null);
  const status = ref<SyncStatus | null>(null);
  const finishedAt = ref<string | null>(null);
  const lanes = ref<LaneState[]>([]);
  /** Whether the event stream is attached; "lost" means the job is gone, usually a server restart. */
  const connection = ref<"idle" | "live" | "lost">("idle");
  const error = ref<string | null>(null);

  const running = computed(() => status.value === "running");

  let source: EventSource | null = null;

  function describeError(e: unknown): string {
    const response = (e as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? (e instanceof Error ? e.message : String(e));
  }

  /** The window list and, if a sync is underway, attach to it. */
  async function load() {
    try {
      const state = await getSyncStateAPI();
      enabled.value = state.enabled;
      minRequestIntervalMs.value = state.minRequestIntervalMs;
      windows.value = state.windows;
      if (state.job && state.job.id !== job.value?.id) attach(state.job);
    } catch (e) {
      error.value = describeError(e);
    }
  }

  async function start(windowKey: string) {
    error.value = null;
    try {
      attach(await startSyncAPI(windowKey));
    } catch (e) {
      error.value = describeError(e);
    }
  }

  async function cancel() {
    if (!job.value) return;
    try {
      await cancelSyncAPI(job.value.id);
    } catch (e) {
      error.value = describeError(e);
    }
  }

  function attach(summary: SyncJobSummary) {
    source?.close();
    job.value = summary;
    status.value = summary.status;
    finishedAt.value = summary.finishedAt;
    lanes.value = summary.window.lanes.map(emptyLane);

    const es = new EventSource(syncEventsURL(summary.id));
    source = es;
    es.onopen = () => (connection.value = "live");
    es.addEventListener("sync", (message) => apply(JSON.parse((message as MessageEvent).data) as SyncEvent));
    es.onerror = () => {
      // A finished job closes its stream, and the browser would otherwise reconnect forever.
      if (status.value !== "running") {
        es.close();
        connection.value = "idle";
      } else if (es.readyState === EventSource.CLOSED) {
        connection.value = "lost";
      }
    };
  }

  function apply(e: SyncEvent) {
    if (e.type === "job-finished") {
      status.value = e.status;
      finishedAt.value = e.at;
      source?.close();
      connection.value = "idle";
      void afterFinish();
      return;
    }
    const lane = lanes.value.find((l) => l.harvestKey === e.lane);
    if (!lane) return;

    switch (e.type) {
      case "started":
        lane.runId = e.runId;
        lane.phase = "counting";
        break;
      case "counted":
        lane.expected = e.expectedRecords;
        break;
      case "slice-planned":
        lane.slices.push({
          sliceKey: e.sliceKey,
          expected: e.expectedRecords,
          retrieved: 0,
          pages: 0,
          state: e.expectedRecords === 0 ? "empty" : "planned",
        });
        break;
      case "slice-split":
        lane.splits.push({ sliceKey: e.sliceKey, expected: e.expectedRecords, into: e.into });
        break;
      case "page": {
        lane.phase = "paging";
        lane.retrieved += e.page.recordCount;
        lane.bytes += e.page.bytes;
        lane.calls.unshift(e.page);
        const slice = lane.slices.find((s) => s.sliceKey === e.page.sliceKey);
        if (slice) {
          slice.retrieved += e.page.recordCount;
          slice.pages++;
          slice.state = "paging";
        }
        break;
      }
      case "slice-done": {
        const slice = lane.slices.find((s) => s.sliceKey === e.sliceKey);
        if (slice) slice.state = e.retrievedRecords === e.expectedRecords ? "done" : "mismatch";
        break;
      }
      case "harvested":
        lane.harvested = e;
        break;
      case "adapting":
        lane.phase = "adapting";
        break;
      case "log":
        lane.lastLog = e.message;
        break;
      case "adapted":
        lane.adapted = e;
        break;
      case "classifying":
        lane.phase = "classifying";
        break;
      case "classified":
        lane.labelled = e.labelled;
        break;
      case "lane-finished":
        lane.phase = "done";
        break;
      case "lane-failed":
        lane.phase = e.cancelled ? "cancelled" : "failed";
        lane.error = e.cancelled ? null : e.message;
        break;
    }
  }

  /** New runs exist now: refresh the window list and the run picker everywhere else. */
  async function afterFinish() {
    const corpus = useCorpusStore();
    await Promise.all([load(), corpus.ready ? corpus.refreshHarvests() : corpus.init()]);
  }

  return {
    enabled,
    minRequestIntervalMs,
    windows,
    job,
    status,
    finishedAt,
    lanes,
    connection,
    error,
    running,
    load,
    start,
    cancel,
  };
});
