import type { HarvestDefinition } from "../config/harvests.ts";
import type { AdaptedRecord } from "../canonical/record.ts";
import type { SnapshotManifest } from "../snapshot/store.ts";

export interface HarvestResult {
  manifest: SnapshotManifest;
  runId: string;
}

export interface HarvestOptions {
  /** Progress reporting, so a slow harvest is legible while it runs. */
  onProgress?: (message: string) => void;
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
