import type { HarvestDefinition } from "../config/harvests.ts";
import type { AdaptedRecord } from "../canonical/record.ts";
import type { SnapshotManifest, SnapshotPage } from "../snapshot/store.ts";

export interface HarvestResult {
  manifest: SnapshotManifest;
  runId: string;
}

/**
 * What a harvest does, as it does it — the structured twin of the progress log, so the
 * dashboard can draw a run while it is happening rather than parse lines of text. Each event
 * follows the request it describes, and a `page` event fires only once that page is frozen on
 * disk, so anything the UI is told about can already be opened.
 */
export type HarvestEvent =
  | { type: "started"; harvestKey: string; runId: string; source: string; query: { q: string; fq: string[] } }
  /** The unpartitioned window has been counted. */
  | { type: "counted"; expectedRecords: number }
  /** A slice has been counted and will be paged as-is (an empty one is reported, then skipped). */
  | { type: "slice-planned"; sliceKey: string; expectedRecords: number }
  /** A slice was over the reachable cap and has been halved by date. */
  | { type: "slice-split"; sliceKey: string; expectedRecords: number; into: [string, string] }
  | { type: "page"; page: SnapshotPage }
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
    };

export interface HarvestOptions {
  /** Progress reporting, so a slow harvest is legible while it runs. */
  onProgress?: (message: string) => void;
  /** Structured progress, for a caller that draws the run rather than prints it. */
  onEvent?: (event: HarvestEvent) => void;
  /**
   * Stops the harvest between requests. An aborted run never writes its manifest, so it is
   * never offered to readers as a run — the pages already frozen are left where they fell.
   */
  signal?: AbortSignal;
}

export interface AdaptContext {
  harvestId: string;
  snapshotPage: string;
  fetchedAt: string;
}

/**
 * What a source has to provide. Two functions: fetch and freeze, then turn frozen bytes into
 * canonical records. Everything else — rate limiting, snapshot layout, storage, analysis, the
 * views — is shared, which is the claim Stage 2 exists to test.
 */
export interface SourceModule {
  key: string;
  label: string;
  /**
   * Top-level key of a frozen page body under which the record array sits — `occurrences`
   * for ALA, `results` for iNaturalist. Declared here so the read layer and the raw-data view
   * can find records in a page without knowing which source produced it.
   */
  recordsKey: string;
  /** Field on a raw record that `provenance.sourceRecordId` was taken from. */
  recordIdField: string;
  harvest(definition: HarvestDefinition, options?: HarvestOptions): Promise<HarvestResult>;
  adaptPage(pageBody: string, context: AdaptContext): AdaptedRecord[];
}
