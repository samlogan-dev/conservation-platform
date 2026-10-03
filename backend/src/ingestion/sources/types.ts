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
 * What a source has to provide: fetch and freeze, then turn the frozen bytes into canonical
 * records. Everything else — rate limiting, snapshot layout, storage, analysis — is shared.
 *
 * Frozen bytes come in two shapes. A paged source freezes one JSON body per request and
 * implements `adaptPage`; a bulk-download source freezes one archive and implements
 * `streamRecords`, because its corpus is too large to hold in memory. `adapt.ts` takes whichever
 * the source offers.
 */
export interface SourceModule {
  key: string;
  label: string;
  harvest(definition: HarvestDefinition, options?: HarvestOptions): Promise<HarvestResult>;
  adaptPage?(pageBody: string, context: AdaptContext): AdaptedRecord[];
  streamRecords?(manifest: SnapshotManifest): AsyncIterable<AdaptedRecord>;
}
