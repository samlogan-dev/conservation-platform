import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";

/**
 * The frozen snapshot store.
 *
 * The one rule: the raw response body is written to disk exactly as it arrived, before
 * anything parses it. Freezing a parsed structure would freeze our reading of the response
 * rather than the response, and it is precisely a wrong early reading that this is insurance
 * against. Because the canonical shape is expected to change more than once, re-adapting from
 * frozen bytes has to be possible without going back to the network.
 */

/** Metadata for one frozen page. */
export interface SnapshotPage {
  /** File name within the run's `pages/` directory. */
  file: string;
  /** The partition this page belongs to — see the harvest's slicing. */
  sliceKey: string;
  startIndex: number;
  pageSize: number;
  /** Records actually returned, which is how truncation is detected. */
  recordCount: number;
  url: string;
  status: number;
  fetchedAt: string;
  durationMs: number;
  attempts: number;
  /** sha256 of the verbatim body. */
  contentHash: string;
  bytes: number;
}

export interface SnapshotSlice {
  sliceKey: string;
  /** The `fq` clauses that define this partition. */
  filters: string[];
  /** What the API said the slice contained before paging began. */
  expectedRecords: number;
  /** What paging actually retrieved. A mismatch is the loudest signal available. */
  retrievedRecords: number;
  pages: number;
}

export interface SnapshotManifest {
  runId: string;
  harvestKey: string;
  description: string;
  source: string;
  /** Base URL in force for this run, so a host migration is visible in the record. */
  baseUrl: string;
  /** The query, recorded in full so the run can be reconstructed from the manifest alone. */
  query: { q: string; fq: string[] };
  /** Fields requested. Half the meaning of the coverage table. */
  requestedFields: string[];
  /** Politeness settings actually in force, not the defaults in the source file. */
  politeness: {
    userAgent: string;
    minRequestIntervalMs: number;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Total the API reported for the unpartitioned window. */
  expectedRecords: number;
  /** Records actually retrieved across all slices. */
  retrievedRecords: number;
  /** True when every slice retrieved exactly what it promised. */
  complete: boolean;
  slices: SnapshotSlice[];
  pages: SnapshotPage[];
  /**
   * sha256 over the page hashes in a canonical order. Two runs of the same harvest that
   * produce the same corpus hash retrieved byte-identical data — which is the concrete
   * meaning of "a snapshot you can re-run and get the same records from".
   */
  corpusHash: string;
  requestCount: number;
  /** Anything that went wrong but did not stop the run. */
  warnings: string[];
}

export const sha256 = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const snapshotsRoot = () => path.resolve(process.cwd(), INGESTION.dataDir, "snapshots");

export const runDir = (harvestKey: string, runId: string) =>
  path.join(snapshotsRoot(), harvestKey, runId);

/** A filesystem-safe, lexicographically sortable run id. */
export const newRunId = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");

export class SnapshotWriter {
  private readonly pages: SnapshotPage[] = [];
  private readonly dir: string;

  constructor(
    readonly harvestKey: string,
    readonly runId: string,
  ) {
    this.dir = runDir(harvestKey, runId);
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.dir, "pages"), { recursive: true });
  }

  /** Freeze one raw page. `body` must be exactly what the source returned. */
  async writePage(
    args: Omit<SnapshotPage, "file" | "contentHash" | "bytes">,
    body: string,
  ): Promise<SnapshotPage> {
    const file = `${args.sliceKey}--${String(args.startIndex).padStart(6, "0")}.json`;
    await writeFile(path.join(this.dir, "pages", file), body, "utf8");
    const page: SnapshotPage = {
      ...args,
      file,
      contentHash: sha256(body),
      bytes: Buffer.byteLength(body, "utf8"),
    };
    this.pages.push(page);
    return page;
  }

  getPages(): SnapshotPage[] {
    return this.pages;
  }

  /** Order-independent so that a change in page *ordering* alone does not change the hash. */
  corpusHash(): string {
    return sha256(
      this.pages
        .map((p) => p.contentHash)
        .sort()
        .join("\n"),
    );
  }

  async writeManifest(manifest: SnapshotManifest): Promise<void> {
    await writeFile(
      path.join(this.dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }
}

export async function readManifest(
  harvestKey: string,
  runId: string,
): Promise<SnapshotManifest> {
  const raw = await readFile(path.join(runDir(harvestKey, runId), "manifest.json"), "utf8");
  return JSON.parse(raw) as SnapshotManifest;
}

export async function readPageBody(
  harvestKey: string,
  runId: string,
  file: string,
): Promise<string> {
  // Guard against a caller reaching outside the run directory via a crafted file name.
  const base = path.join(runDir(harvestKey, runId), "pages");
  const resolved = path.resolve(base, file);
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error(`refusing to read outside the snapshot directory: ${file}`);
  }
  return readFile(resolved, "utf8");
}

/**
 * Run ids for a harvest, newest first.
 *
 * A run exists once its manifest does. The manifest is written last, so a harvest still in
 * progress — or one that died mid-way — has a directory of pages and no manifest, and must
 * not be offered to readers as a run.
 */
export async function listRuns(harvestKey: string): Promise<string[]> {
  try {
    const dir = path.join(snapshotsRoot(), harvestKey);
    const entries = await readdir(dir, { withFileTypes: true });
    const finished: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        await access(path.join(dir, e.name, "manifest.json"));
        finished.push(e.name);
      } catch {
        // No manifest yet: in progress, or abandoned.
      }
    }
    return finished.sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listHarvestsWithSnapshots(): Promise<string[]> {
  try {
    const entries = await readdir(snapshotsRoot(), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The newest run for a harvest, or null if it has never been run. */
export async function latestRunId(harvestKey: string): Promise<string | null> {
  const runs = await listRuns(harvestKey);
  return runs[0] ?? null;
}
