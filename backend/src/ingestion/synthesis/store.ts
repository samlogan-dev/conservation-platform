import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";
import type { Synthesis } from "./types.ts";

/**
 * Where syntheses live: one file per family per model.
 *
 *   data/syntheses/<familyKey>/<model>.json
 *
 * A family — species, region, window — rather than a run, because the synthesis reads every
 * source at once and is the same document whichever sibling run the page was opened from.
 * The file carries the evidence hash it was generated from, so a changed family (a new run,
 * a new classifier pass) shows as stale instead of silently out of date.
 */
const root = () => path.resolve(process.cwd(), INGESTION.dataDir, "syntheses");

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

export const familyKeyOf = (scope: { speciesKey: string; regionKey: string; startDate: string; endDate: string }) =>
  safe(`${scope.speciesKey}__${scope.regionKey}__${scope.startDate}__${scope.endDate}`);

const file = (familyKey: string, model: string) => path.join(root(), familyKey, `${safe(model)}.json`);

export async function writeSynthesis(s: Synthesis): Promise<string> {
  const target = file(s.familyKey, s.model);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(s, null, 2), "utf8");
  return target;
}

export async function readSynthesis(familyKey: string, model: string): Promise<Synthesis | null> {
  try {
    return JSON.parse(await readFile(file(familyKey, model), "utf8")) as Synthesis;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
