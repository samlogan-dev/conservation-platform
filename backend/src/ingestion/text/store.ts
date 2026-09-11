import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";
import type { ClassificationRun, ClassifierKey } from "./types.ts";

/**
 * Where classification runs live: one file per classifier per harvest run.
 *
 *   data/classifications/<harvestKey>/<runId>/<classifier>.json
 *
 * Kept apart from the canonical records on purpose. A classification is a claim *about* a
 * record made by a particular classifier under a particular prompt; it is regenerable, it can
 * be wrong, and two classifiers can disagree about the same record. That is a separate table
 * with a foreign key, not a column.
 */
const root = () => path.resolve(process.cwd(), INGESTION.dataDir, "classifications");

const file = (harvestKey: string, runId: string, classifier: ClassifierKey) =>
  path.join(root(), harvestKey, runId, `${classifier}.json`);

export async function writeClassificationRun(run: ClassificationRun): Promise<string> {
  const target = file(run.harvestKey, run.runId, run.classifier);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(run), "utf8");
  return target;
}

export async function readClassificationRun(
  harvestKey: string,
  runId: string,
  classifier: ClassifierKey,
): Promise<ClassificationRun | null> {
  try {
    return JSON.parse(await readFile(file(harvestKey, runId, classifier), "utf8")) as ClassificationRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Which classifiers have a stored pass over this run, with the file's modification time. */
export async function listClassificationRuns(
  harvestKey: string,
  runId: string,
): Promise<{ classifier: ClassifierKey; modifiedAt: number }[]> {
  const dir = path.join(root(), harvestKey, runId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: { classifier: ClassifierKey; modifiedAt: number }[] = [];
  for (const name of names) {
    if (name !== "keyword.json" && name !== "llm.json") continue;
    const s = await stat(path.join(dir, name));
    out.push({ classifier: name.replace(".json", "") as ClassifierKey, modifiedAt: s.mtimeMs });
  }
  return out;
}
