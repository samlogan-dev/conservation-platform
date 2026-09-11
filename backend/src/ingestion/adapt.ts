import { readManifest, readPageBody } from "./snapshot/store.ts";
import { getSource } from "./sources/registry.ts";
import { recordStore } from "./store/recordStore.ts";
import type { AdaptedRecord } from "./canonical/record.ts";

/**
 * Re-adapt a frozen snapshot into canonical records.
 *
 * Deliberately a separate step from harvesting, and this is the payoff for freezing raw
 * responses: when the canonical shape changes — which Stage 1 expects more than once — the
 * schema is re-derived from disk in seconds, with no network traffic and no new load on ALA.
 * The corpus stays byte-identical across schema revisions, so a change in the output is
 * attributable to the adapter rather than to the source having moved underneath it.
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
): Promise<{ summary: AdaptSummary; records: AdaptedRecord[] }> {
  const manifest = await readManifest(harvestKey, runId);
  const source = getSource(manifest.source);

  const records: AdaptedRecord[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

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
      records.push(item);
    }
  }

  await recordStore.save(harvestKey, runId, records);

  const summary: AdaptSummary = {
    harvestKey,
    runId,
    pagesRead: manifest.pages.length,
    recordsAdapted: records.length,
    recordsValid: records.filter((r) => r.record.isValid).length,
    recordsWithErrors: records.filter((r) => !r.record.isValid).length,
    duplicates,
  };

  return { summary, records };
}
