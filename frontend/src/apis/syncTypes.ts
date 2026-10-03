import type { SnapshotPageMeta } from "./corpusTypes";

/** Mirrors backend/src/ingestion/sync/job.ts. */

export type SyncStatus = "running" | "finished" | "failed" | "cancelled";

export interface SyncLastRun {
  runId: string;
  retrievedRecords: number;
  requestCount: number;
  durationMs: number;
  corpusHash: string;
  complete: boolean;
}

export interface SyncWindow {
  key: string;
  label: string;
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  lanes: { harvestKey: string; source: string; label: string; lastRun: SyncLastRun | null }[];
}

export interface SyncJobSummary {
  id: string;
  window: SyncWindow;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  events: number;
}

export interface SyncState {
  enabled: boolean;
  minRequestIntervalMs: number;
  windows: SyncWindow[];
  job: SyncJobSummary | null;
}

export type SyncPayload =
  | { type: "job-started"; jobId: string; window: SyncWindow }
  | { type: "started"; harvestKey: string; runId: string; source: string; query: { q: string; fq: string[] } }
  | { type: "counted"; expectedRecords: number }
  | { type: "slice-planned"; sliceKey: string; expectedRecords: number }
  | { type: "slice-split"; sliceKey: string; expectedRecords: number; into: [string, string] }
  | { type: "page"; page: SnapshotPageMeta }
  | { type: "slice-done"; sliceKey: string; expectedRecords: number; retrievedRecords: number }
  | {
      type: "harvested";
      complete: boolean;
      expectedRecords: number;
      retrievedRecords: number;
      corpusHash: string;
      requestCount: number;
      durationMs: number;
      warnings: string[];
    }
  | { type: "adapting" }
  | { type: "adapted"; recordsAdapted: number; recordsValid: number; duplicates: number }
  | { type: "classifying" }
  | { type: "classified"; labelled: number }
  | { type: "log"; message: string }
  | { type: "lane-finished" }
  | { type: "lane-failed"; message: string; cancelled: boolean }
  | { type: "job-finished"; status: SyncStatus };

export type SyncEvent = { seq: number; at: string; lane: string | null } & SyncPayload;

export interface LivePage {
  recordsKey: string;
  body: string;
}
