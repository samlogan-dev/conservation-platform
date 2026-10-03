import { readManifest, readPageBody, type SnapshotManifest } from "./snapshot/store.ts";
import { getSource } from "./sources/registry.ts";
import type { SourceModule } from "./sources/types.ts";
import { BATCH_SIZE, recordStore } from "./store/recordStore.ts";
import { CorpusAnalyser } from "./analysis/coverage.ts";
import type { AdaptedRecord, StoredRecord } from "./canonical/record.ts";

/**
 * Re-adapt a frozen snapshot into canonical records and load them.
 *
 * Deliberately a separate step from harvesting, and this is the payoff for freezing raw
 * responses: when the canonical shape changes — which is expected more than once — the
 * schema is re-derived from disk, with no network traffic and no new load on the source.
 * The corpus stays byte-identical across schema revisions, so a change in the output is
 * attributable to the adapter rather than to the source having moved underneath it.
 *
 * Records stream through: each is adapted, counted into the corpus analysis, and loaded in
 * batches; the mapping trace is dropped once the analysis has read it. Memory stays bounded
 * whether the snapshot is a hundred-record page or a two-million-row download.
 */
export interface AdaptSummary {
  harvestKey: string;
  runId: string;
  recordsAdapted: number;
  recordsValid: number;
  recordsWithErrors: number;
  /** Records whose source id collided with one already seen. */
  duplicates: number;
}

/** A paged snapshot, page by page, as one stream of records. */
async function* pagedRecords(source: SourceModule, manifest: SnapshotManifest): AsyncGenerator<AdaptedRecord> {
  for (const page of manifest.pages) {
    const body = await readPageBody(manifest.harvestKey, manifest.runId, page.file);
    yield* source.adaptPage!(body, {
      harvestId: `${manifest.harvestKey}/${manifest.runId}`,
      snapshotPage: page.file,
      fetchedAt: page.fetchedAt,
    });
  }
}

const PROGRESS_EVERY = 100_000;

export async function adaptRun(
  harvestKey: string,
  runId: string,
  options: { onProgress?: (message: string) => void } = {},
): Promise<{ summary: AdaptSummary }> {
  const log = options.onProgress ?? (() => {});
  const manifest = await readManifest(harvestKey, runId);
  const source = getSource(manifest.source);
  const records = source.streamRecords
    ? source.streamRecords(manifest)
    : source.adaptPage
      ? pagedRecords(source, manifest)
      : null;
  if (!records) throw new Error(`source "${source.key}" can neither stream records nor adapt pages`);

  const analyser = new CorpusAnalyser();
  const seen = new Set<string>();
  const summary: AdaptSummary = { harvestKey, runId, recordsAdapted: 0, recordsValid: 0, recordsWithErrors: 0, duplicates: 0 };
  let batch: StoredRecord[] = [];

  const writer = await recordStore.openRun(manifest);
  try {
    for await (const item of records) {
      // The same record can appear twice (ALA returns a record in two slices when its date sits on
      // a boundary). De-duplicating on the source record id keeps the corpus honest; counting the
      // collisions keeps the fact visible rather than silently absorbed.
      if (seen.has(item.record.recordId)) {
        summary.duplicates++;
        continue;
      }
      seen.add(item.record.recordId);
      analyser.add(item);
      summary.recordsAdapted++;
      if (item.record.isValid) summary.recordsValid++;
      else summary.recordsWithErrors++;
      batch.push({
        record: item.record,
        issueCount: item.trace.validationIssues.length,
        unmappedCount: item.trace.unmappedSourceFields.length,
      });
      if (batch.length >= BATCH_SIZE) {
        await writer.append(batch);
        batch = [];
      }
      if (summary.recordsAdapted % PROGRESS_EVERY === 0) log(`  adapted ${summary.recordsAdapted} records`);
    }
    if (batch.length > 0) await writer.append(batch);
    await writer.commit(analyser.finish(harvestKey, runId));
  } catch (error) {
    await writer.abort();
    throw error;
  }
  return { summary };
}
