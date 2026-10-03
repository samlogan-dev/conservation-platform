import { readManifest, readPageBody } from "./snapshot/store.ts";
import { getSource } from "./sources/registry.ts";
import { recordStore } from "./store/recordStore.ts";
import { CorpusAnalyser } from "./analysis/coverage.ts";
import type { StoredRecord } from "./canonical/record.ts";

/**
 * Re-adapt a frozen snapshot into canonical records.
 *
 * Deliberately a separate step from harvesting, and this is the payoff for freezing raw
 * responses: when the canonical shape changes — which is expected more than once — the
 * schema is re-derived from disk in seconds, with no network traffic and no new load on the source.
 * The corpus stays byte-identical across schema revisions, so a change in the output is
 * attributable to the adapter rather than to the source having moved underneath it.
 *
 * Pages are processed one at a time and only the slim record is kept; the trace feeds the
 * corpus analysis as it goes and is then dropped. That is what lets a large harvest be adapted
 * in a bounded amount of memory.
 */
export interface AdaptSummary {
  harvestKey: string;
  runId: string;
  pagesRead: number;
  recordsAdapted: number;
  recordsValid: number;
  recordsWithErrors: number;
  /** Records whose source id collided with one already seen. */
  duplicates: number;
}

export async function adaptRun(
  harvestKey: string,
  runId: string,
  options: { onProgress?: (message: string) => void } = {},
): Promise<{ summary: AdaptSummary; records: StoredRecord[] }> {
  const log = options.onProgress ?? (() => {});
  const manifest = await readManifest(harvestKey, runId);
  const source = getSource(manifest.source);

  const stored: StoredRecord[] = [];
  const analyser = new CorpusAnalyser();
  const seen = new Set<string>();
  let duplicates = 0;
  let pagesRead = 0;

  for (const page of manifest.pages) {
    const body = await readPageBody(harvestKey, runId, page.file);
    const adapted = source.adaptPage(body, {
      harvestId: `${harvestKey}/${runId}`,
      snapshotPage: page.file,
      fetchedAt: page.fetchedAt,
    });

    for (const item of adapted) {
      // ALA can return the same record in two slices if its event date sits on a boundary.
      // De-duplicating on the source record id keeps the canonical set honest, and counting
      // the collisions keeps the fact visible rather than silently absorbed.
      if (seen.has(item.record.recordId)) {
        duplicates++;
        continue;
      }
      seen.add(item.record.recordId);
      analyser.add(item);
      stored.push({
        record: item.record,
        issueCount: item.trace.validationIssues.length,
        unmappedCount: item.trace.unmappedSourceFields.length,
      });
    }

    pagesRead++;
    if (pagesRead % 100 === 0) log(`  adapted ${pagesRead}/${manifest.pages.length} pages, ${stored.length} records`);
  }

  await recordStore.save(harvestKey, runId, stored, analyser.finish(harvestKey, runId));

  const summary: AdaptSummary = {
    harvestKey,
    runId,
    pagesRead,
    recordsAdapted: stored.length,
    recordsValid: stored.filter((r) => r.record.isValid).length,
    recordsWithErrors: stored.filter((r) => !r.record.isValid).length,
    duplicates,
  };

  return { summary, records: stored };
}
