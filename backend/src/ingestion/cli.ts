import "dotenv/config";
import { DEFAULT_HARVEST, HARVESTS } from "./config/harvests.ts";
import { getSource } from "./sources/registry.ts";
import { adaptRun } from "./adapt.ts";
import { latestRunId, listRuns, readManifest } from "./snapshot/store.ts";
import { recordStore } from "./store/recordStore.ts";
import { closeDb } from "../db/pool.ts";

/**
 * Ingestion CLI.
 *
 * `harvest` and `adapt` are separate commands on purpose: re-adapting a frozen snapshot needs
 * no network access, so the schema can be iterated on as fast as it can be edited.
 *
 *   npm run ingest -- harvest  [harvestKey]
 *   npm run ingest -- adapt    [harvestKey] [runId]
 *   npm run ingest -- report   [harvestKey] [runId]
 *   npm run ingest -- runs     [harvestKey]
 */

const log = (m: string) => console.log(m);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function resolveRun(harvestKey: string, runId?: string): Promise<string> {
  const resolved = runId ?? (await latestRunId(harvestKey));
  if (!resolved) throw new Error(`no snapshots for harvest "${harvestKey}" — run harvest first`);
  return resolved;
}

async function report(harvestKey: string, runId: string): Promise<void> {
  const manifest = await readManifest(harvestKey, runId);
  const analysis = await recordStore.loadAnalysis(harvestKey, runId);

  log(`\n=== ${harvestKey} / ${runId} ===`);
  log(manifest.description);
  log(
    `snapshot: ${manifest.retrievedRecords}/${manifest.expectedRecords} records · ` +
      `${manifest.slices.length} slices · ${manifest.pages.length} pages · ` +
      `${manifest.requestCount} requests · ${(manifest.durationMs / 1000).toFixed(1)}s`,
  );
  log(`corpus hash: ${manifest.corpusHash}`);
  log(`complete: ${manifest.complete}`);
  if (manifest.warnings.length > 0) {
    log(`warnings:`);
    for (const w of manifest.warnings) log(`  ! ${w}`);
  }

  log(`\n--- free text by substance ---`);
  for (const f of analysis.freeText) {
    log(
      `  ${f.canonicalField.padEnd(20)} substantive ${String(f.bands.substantive).padStart(5)} ` +
        `(${pct(f.substantiveShare).padStart(6)})  short ${String(f.bands.short).padStart(5)}  ` +
        `trivial ${String(f.bands.trivial).padStart(5)}  absent ${String(f.bands.absent).padStart(5)}  ` +
        `median ${f.medianLength}ch`,
    );
    for (const s of f.samples) log(`      ${s.band.padEnd(12)} ${JSON.stringify(s.value)}`);
  }

  log(`\n--- contributing data resources ---`);
  for (const r of analysis.resources) {
    log(
      `  ${String(r.records).padStart(5)} (${pct(r.share).padStart(6)})  ` +
        `${r.dataResourceName.slice(0, 48).padEnd(50)} substantive text ${r.substantiveRemarks}` +
        // Median, not mean: obscured threatened-species locations sit tens of km out and drag
        // an average into describing neither the GPS records nor the obscured ones.
        `${r.medianCoordinateUncertainty !== null ? ` · median uncertainty ${Math.round(r.medianCoordinateUncertainty)}m` : ""}` +
        `${r.obscuredRecords ? ` · ${r.obscuredRecords} obscured >10km` : ""}`,
    );
  }

  log(`\n--- canonical field coverage (lowest first) ---`);
  for (const f of [...analysis.fields].sort((a, b) => a.coverage - b.coverage).slice(0, 18)) {
    log(
      `  ${pct(f.coverage).padStart(6)}  ${f.canonicalField.padEnd(34)} ` +
        `absent ${String(f.counts.absent_from_source).padStart(5)}  ` +
        `rejected ${String(f.counts.rejected).padStart(4)}`,
    );
  }

  if (analysis.unmappedSourceFields.length > 0) {
    log(`\n--- source fields no mapping consumed ---`);
    for (const u of analysis.unmappedSourceFields.slice(0, 15)) {
      log(`  ${String(u.records).padStart(5)} (${pct(u.share).padStart(6)})  ${u.field}  e.g. ${JSON.stringify(u.exampleValue).slice(0, 60)}`);
    }
  }

  log(`\n--- basic validation ---`);
  log(`  ${analysis.validRecords}/${analysis.totalRecords} records passed`);
  for (const v of analysis.validation) {
    log(`  ${String(v.count).padStart(5)}  [${v.severity}] ${v.code}`);
  }

  log(`\n--- source-supplied quality assertions (${manifest.source}) ---`);
  for (const a of analysis.sourceAssertions.slice(0, 12)) {
    log(`  ${String(a.count).padStart(5)} (${pct(a.share).padStart(6)})  ${a.assertion}`);
  }
  log("");
}

async function main(): Promise<void> {
  const [command = "harvest", arg1, arg2] = process.argv.slice(2);

  switch (command) {
    case "harvest": {
      const key = arg1 ?? DEFAULT_HARVEST;
      const harvest = HARVESTS[key];
      if (!harvest) throw new Error(`unknown harvest "${key}" — known: ${Object.keys(HARVESTS).join(", ")}`);
      const { runId } = await getSource(harvest.source).harvest(harvest, { onProgress: log });
      const { summary } = await adaptRun(key, runId, { onProgress: log });
      log(
        `adapted ${summary.recordsAdapted} records ` +
          `(${summary.recordsValid} valid, ${summary.duplicates} duplicates removed)`,
      );
      await report(key, runId);
      break;
    }
    case "adapt": {
      const key = arg1 ?? DEFAULT_HARVEST;
      const runId = await resolveRun(key, arg2);
      const { summary } = await adaptRun(key, runId, { onProgress: log });
      log(JSON.stringify(summary, null, 2));
      await report(key, runId);
      break;
    }
    case "report": {
      const key = arg1 ?? DEFAULT_HARVEST;
      await report(key, await resolveRun(key, arg2));
      break;
    }
    case "runs": {
      const key = arg1 ?? DEFAULT_HARVEST;
      for (const runId of await listRuns(key)) {
        const m = await readManifest(key, runId);
        log(`${runId}  ${m.retrievedRecords}/${m.expectedRecords}  complete=${m.complete}  ${m.corpusHash.slice(0, 16)}`);
      }
      break;
    }
    default:
      throw new Error(`unknown command "${command}" — use harvest | adapt | report | runs`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
