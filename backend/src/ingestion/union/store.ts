import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { labelRecords } from "../analysis/text.ts";
import { INGESTION } from "../config/ingestion.ts";
import { recordStore } from "../store/recordStore.ts";
import { listClassificationRuns, readClassificationRun } from "../text/store.ts";
import type { ClassifierKey } from "../text/types.ts";
import { UNION_VERSION, computeUnion, type UnionCounts } from "./compute.ts";

/**
 * Where merged-corpus summaries live: one file per window per classifier.
 *
 *   data/derived/union/<familyKey>__<classifier>.json
 *
 * Merging a window means loading every source's records, which for a large year is tens of
 * megabytes of JSON. So it is done once and stored, and the stored summary names exactly what
 * it was computed from: the run of each source, and the modification time of each classifier
 * pass. A new run or a new classifier pass changes that list, and the summary is recomputed
 * the next time it is asked for. Nothing has to remember to invalidate it.
 *
 * Records are read straight from the record store rather than through corpusService's
 * per-process cache, so building twelve years of summaries does not leave twelve years of
 * records in memory.
 */

export interface UnionMemberRef {
  harvestKey: string;
  source: string;
  runId: string;
  complete: boolean;
}

export interface UnionInput {
  harvestKey: string;
  runId: string;
  /** Modification time of the classifier pass used, or null where none had read the run. */
  classifiedAt: number | null;
}

export interface UnionSummary extends UnionCounts {
  version: number;
  familyKey: string;
  computedAt: string;
  inputs: UnionInput[];
}

const root = () => path.resolve(process.cwd(), INGESTION.dataDir, "derived", "union");
const file = (familyKey: string, classifier: ClassifierKey | null) =>
  path.join(root(), `${familyKey}__${classifier ?? "none"}.json`);

async function inputsFor(members: UnionMemberRef[], classifier: ClassifierKey | null): Promise<UnionInput[]> {
  return Promise.all(
    members.map(async (m) => {
      const pass = classifier
        ? (await listClassificationRuns(m.harvestKey, m.runId)).find((c) => c.classifier === classifier)
        : undefined;
      return { harvestKey: m.harvestKey, runId: m.runId, classifiedAt: pass?.modifiedAt ?? null };
    }),
  );
}

const sameInputs = (a: UnionInput[], b: UnionInput[]) =>
  a.length === b.length &&
  a.every((x, i) => x.harvestKey === b[i]!.harvestKey && x.runId === b[i]!.runId && x.classifiedAt === b[i]!.classifiedAt);

async function readStored(familyKey: string, classifier: ClassifierKey | null): Promise<UnionSummary | null> {
  try {
    return JSON.parse(await readFile(file(familyKey, classifier), "utf8")) as UnionSummary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function compute(
  familyKey: string,
  members: UnionMemberRef[],
  classifier: ClassifierKey | null,
  inputs: UnionInput[],
): Promise<UnionSummary> {
  const loaded = [];
  for (const m of members) {
    const run = classifier ? await readClassificationRun(m.harvestKey, m.runId, classifier) : null;
    loaded.push({
      ...m,
      records: await recordStore.load(m.harvestKey, m.runId),
      labels: run ? labelRecords(run) : null,
    });
  }
  const summary: UnionSummary = {
    version: UNION_VERSION,
    familyKey,
    computedAt: new Date().toISOString(),
    inputs,
    ...computeUnion(loaded, classifier),
  };
  await mkdir(root(), { recursive: true });
  await writeFile(file(familyKey, classifier), JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

// One computation per window and classifier at a time: two pages opened together share it.
const inFlight = new Map<string, Promise<UnionSummary>>();

/** The merged corpus for a window: the stored summary if it is current, otherwise computed now. */
export async function getUnion(
  familyKey: string,
  members: UnionMemberRef[],
  classifier: ClassifierKey | null,
): Promise<UnionSummary> {
  const inputs = await inputsFor(members, classifier);
  const stored = await readStored(familyKey, classifier);
  if (stored && stored.version === UNION_VERSION && sameInputs(stored.inputs, inputs)) return stored;

  const key = `${familyKey}__${classifier ?? "none"}`;
  const running = inFlight.get(key);
  if (running) return running;
  const task = compute(familyKey, members, classifier, inputs).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}
