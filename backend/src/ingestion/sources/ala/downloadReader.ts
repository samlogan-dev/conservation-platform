import { parse } from "csv-parse";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import type { AdaptedRecord } from "../../canonical/record.ts";
import { pageFilePath, type SnapshotManifest } from "../../snapshot/store.ts";
import { adaptAlaRecord } from "./adapter.ts";

/**
 * Reads a frozen ALA bulk download back into canonical records, streaming.
 *
 * The download's CSV uses display labels ("Decimal latitude (WGS84)") as column names, but its
 * `headings.csv` lists, column by column, the field each was requested as — the same names the
 * search API returns. Renaming columns through it lets the download reuse the search API's
 * adapter unchanged, so there is one mapping into the canonical record, not two that can drift.
 *
 * Columns are matched **by position**, not by label: labels are not unique (`locality` and
 * `raw_locality` are both "Locality"), and matching by label silently lets one overwrite the
 * other — found on the first test download, where locality came out 0% populated.
 *
 * Two differences from the search API are absorbed here, before the adapter sees a row:
 *  - Quality assertions arrive as one true/false column per assertion code (only codes that
 *    fire somewhere in the download get a column). They are folded back into the `assertions`
 *    array the search API returns.
 *  - Every column is present on every row, empty or not. Empty cells are dropped, so an
 *    unpopulated field reads as absent — as the search API omits it — and field coverage means
 *    the same thing whichever path a record came by.
 */

interface ZipEntries {
  zip: yauzl.ZipFile;
  entries: yauzl.Entry[];
}

function openZip(path: string): Promise<ZipEntries> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`could not open ${path}`));
      const entries: yauzl.Entry[] = [];
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.push(entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve({ zip, entries }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err || !stream ? reject(err) : resolve(stream)));
  });
}

async function readSmallEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await entryStream(zip, entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Large downloads may be split across several data files; all of them are read, in order. */
const isDataFile = (name: string) => /^data(_\d+)?\.csv$/i.test(name.split("/").pop() ?? "");

interface Heading {
  label: string;
  /** The field the column was requested as. */
  field: string;
  /** True for a quality-assertion flag column rather than a field. */
  isAssertion: boolean;
}

async function readHeadings(zip: yauzl.ZipFile, entries: yauzl.Entry[]): Promise<Heading[]> {
  const entry = entries.find((e) => e.fileName.toLowerCase().endsWith("headings.csv"));
  if (!entry) throw new Error("download has no headings.csv — cannot map its columns");
  const text = await readSmallEntry(zip, entry);
  const rows = await new Promise<Record<string, string>[]>((resolve, reject) =>
    parse(text, { columns: true, bom: true }, (err, out: Record<string, string>[]) => (err ? reject(err) : resolve(out))),
  );
  return rows.map((row) => {
    const label = row["Column name"] ?? "";
    const field = row["Requested field"] || label;
    // Assertion columns carry an upper-case code and no index field behind them.
    const isAssertion = !row["Field name"] && /^[A-Z0-9_]+$/.test(field);
    return { label, field, isAssertion };
  });
}

/** Each data row as the search API would have returned it. */
async function* rawRows(zipPath: string): AsyncGenerator<Record<string, unknown>> {
  const { zip, entries } = await openZip(zipPath);
  try {
    const headings = await readHeadings(zip, entries);
    const dataEntries = entries.filter((e) => isDataFile(e.fileName)).sort((a, b) => a.fileName.localeCompare(b.fileName));
    if (dataEntries.length === 0) throw new Error("download has no data.csv");

    for (const entry of dataEntries) {
      const parser = (await entryStream(zip, entry)).pipe(parse({ bom: true }));
      let header: string[] | null = null;
      for await (const row of parser as AsyncIterable<string[]>) {
        if (header === null) {
          header = row;
          const mismatch = header.findIndex((label, i) => headings[i]?.label !== label);
          if (header.length !== headings.length || mismatch !== -1) {
            throw new Error(
              `${entry.fileName}: columns do not line up with headings.csv ` +
                `(${header.length} vs ${headings.length} columns; first mismatch at ${mismatch}: "${header[mismatch]}")`,
            );
          }
          continue;
        }
        const raw: Record<string, unknown> = {};
        const assertions: string[] = [];
        row.forEach((value, i) => {
          if (value === "" || value === undefined) return;
          const heading = headings[i]!;
          if (heading.isAssertion) {
            if (value === "true") assertions.push(heading.field);
            return;
          }
          raw[heading.field] = value;
        });
        if (assertions.length > 0) raw["assertions"] = assertions;
        // The search API returns the record id as `uuid`; the download names it as requested.
        if (raw["id"] !== undefined && raw["uuid"] === undefined) {
          raw["uuid"] = raw["id"];
          delete raw["id"];
        }
        yield raw;
      }
    }
  } finally {
    zip.close();
  }
}

/** Rows in the archive — the reconciliation count for the harvest. */
export async function countDownloadRows(zipPath: string): Promise<number> {
  let n = 0;
  for await (const _ of rawRows(zipPath)) n++;
  return n;
}

/** The download as canonical records, one at a time. */
export async function* streamAlaDownload(manifest: SnapshotManifest): AsyncGenerator<AdaptedRecord> {
  const page = manifest.pages[0];
  if (!page) throw new Error(`manifest for ${manifest.harvestKey}/${manifest.runId} lists no archive`);
  const zipPath = pageFilePath(manifest.harvestKey, manifest.runId, page.file);
  const context = {
    harvestId: `${manifest.harvestKey}/${manifest.runId}`,
    snapshotPage: page.file,
    fetchedAt: page.fetchedAt,
  };
  for await (const raw of rawRows(zipPath)) yield adaptAlaRecord(raw, context);
}
