import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";
import type { AdaptedRecord } from "../canonical/record.ts";

/**
 * Where adapted records live.
 *
 * Stage 1 writes canonical JSON to disk rather than to Supabase. The Build Scope sanctions
 * this explicitly — "if Supabase setup slows the loop early on, writing canonical JSON to disk
 * first and adding Postgres once the shape settles is a reasonable trade" — and it is the
 * right trade here for a reason beyond setup cost: the canonical shape is expected to be wrong
 * and to change more than once during this stage, so a migration per schema revision would be
 * pure friction while the thing being settled is the schema itself.
 *
 * The interface below is the part that matters. A Supabase implementation is one class, and
 * nothing upstream of it changes.
 */
export interface RecordStore {
  save(harvestKey: string, runId: string, records: AdaptedRecord[]): Promise<void>;
  load(harvestKey: string, runId: string): Promise<AdaptedRecord[]>;
}

export class JsonFileRecordStore implements RecordStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.resolve(process.cwd(), INGESTION.dataDir, "canonical");
  }

  private file(harvestKey: string, runId: string): string {
    return path.join(this.root, harvestKey, `${runId}.json`);
  }

  async save(harvestKey: string, runId: string, records: AdaptedRecord[]): Promise<void> {
    const file = this.file(harvestKey, runId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(records, null, 2), "utf8");
  }

  async load(harvestKey: string, runId: string): Promise<AdaptedRecord[]> {
    const raw = await readFile(this.file(harvestKey, runId), "utf8");
    return JSON.parse(raw) as AdaptedRecord[];
  }
}

export const recordStore: RecordStore = new JsonFileRecordStore();
