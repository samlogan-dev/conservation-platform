import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";
import type { StoredRecord } from "../canonical/record.ts";
import type { CorpusAnalysis } from "../analysis/coverage.ts";

/**
 * Where adapted records live.
 *
 * Canonical JSON on disk for now. Supabase is the intended home once the schema settles; until
 * then a migration per schema revision would be pure friction.
 *
 * Two files per run: the records (slim, see `StoredRecord`) and the corpus analysis computed
 * while adapting. Traces are not stored; see `StoredRecord` for why.
 *
 * The interface below is the part that matters. A Supabase implementation is one class, and
 * nothing upstream of it changes.
 */
export interface RecordStore {
  save(
    harvestKey: string,
    runId: string,
    records: StoredRecord[],
    analysis: CorpusAnalysis,
  ): Promise<void>;
  load(harvestKey: string, runId: string): Promise<StoredRecord[]>;
  loadAnalysis(harvestKey: string, runId: string): Promise<CorpusAnalysis>;
}

export class JsonFileRecordStore implements RecordStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.resolve(process.cwd(), INGESTION.dataDir, "canonical");
  }

  private recordsFile(harvestKey: string, runId: string): string {
    return path.join(this.root, harvestKey, `${runId}.json`);
  }

  private analysisFile(harvestKey: string, runId: string): string {
    return path.join(this.root, harvestKey, `${runId}.analysis.json`);
  }

  async save(
    harvestKey: string,
    runId: string,
    records: StoredRecord[],
    analysis: CorpusAnalysis,
  ): Promise<void> {
    const file = this.recordsFile(harvestKey, runId);
    await mkdir(path.dirname(file), { recursive: true });
    // Compact rather than pretty-printed: a large harvest is tens of megabytes, and nobody
    // reads this file by eye.
    await writeFile(file, JSON.stringify(records), "utf8");
    await writeFile(this.analysisFile(harvestKey, runId), JSON.stringify(analysis, null, 2), "utf8");
  }

  async load(harvestKey: string, runId: string): Promise<StoredRecord[]> {
    const raw = await readFile(this.recordsFile(harvestKey, runId), "utf8");
    const parsed = JSON.parse(raw) as StoredRecord[];
    // A file written before the store was split carries `trace` per record. Refuse it with a
    // pointer to the fix rather than serving a shape the rest of the service no longer expects.
    if (parsed.length > 0 && "trace" in (parsed[0] as object)) {
      throw new Error(
        `canonical file for ${harvestKey}/${runId} predates the store split — run: npm run ingest -- adapt ${harvestKey} ${runId}`,
      );
    }
    return parsed;
  }

  async loadAnalysis(harvestKey: string, runId: string): Promise<CorpusAnalysis> {
    const raw = await readFile(this.analysisFile(harvestKey, runId), "utf8");
    return JSON.parse(raw) as CorpusAnalysis;
  }
}

export const recordStore: RecordStore = new JsonFileRecordStore();
