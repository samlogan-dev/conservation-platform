import "dotenv/config";
import { DEFAULT_HARVEST, HARVESTS } from "./config/harvests.ts";
import { getSource } from "./sources/registry.ts";
import { adaptRun } from "./adapt.ts";
import { latestRunId, listRuns, readManifest } from "./snapshot/store.ts";
import { recordStore } from "./store/recordStore.ts";
import { classifyRun, makeClassifier } from "./text/job.ts";
import { evaluateClassifier } from "./text/synthetic.ts";
import { summariseText } from "./analysis/text.ts";
import type { ClassifierKey } from "./text/types.ts";
import { getFamily } from "./corpusService.ts";
import { synthesiseFamily } from "./synthesis/job.ts";
import { getTimeline, getWindowUnion, listScopes } from "./portalService.ts";

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
 *   npm run ingest -- classify [harvestKey] [runId] [--classifier keyword|llm] [--limit N] [--force]
 *   npm run ingest -- evaluate [--classifier keyword|llm]
 *   npm run ingest -- synthesise [harvestKey] [runId] [--force]
 *   npm run ingest -- union    [speciesKey] [regionKey]
 */

const log = (m: string) => console.log(m);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** `--key value`, `--key=value` and bare `--flag`; everything else is positional. */
function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(key!, inline);
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) flags.set(key!, argv[++i]!);
    else flags.set(key!, "true");
  }
  return { positional, flags };
}

function classifierFrom(flags: Map<string, string>): ClassifierKey {
  const key = flags.get("classifier") ?? "keyword";
  if (key !== "keyword" && key !== "llm") throw new Error(`unknown classifier "${key}" — use keyword | llm`);
  return key;
}

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

  log(`\n--- free text: is there enough to classify at all? ---`);
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
        // Median, not mean: obscured threatened-species locations sit ~28km out and drag an
        // average into describing neither the GPS records nor the obscured ones.
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
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command = "harvest", arg1, arg2] = positional;

  switch (command) {
    case "classify": {
      const key = arg1 ?? DEFAULT_HARVEST;
      const runId = await resolveRun(key, arg2);
      const classifier = makeClassifier(classifierFrom(flags));
      const run = await classifyRun(key, runId, classifier, {
        limit: flags.has("limit") ? Number(flags.get("limit")) : undefined,
        force: flags.get("force") === "true",
        onProgress: log,
      });
      const summary = summariseText(await recordStore.load(key, runId), run, null);
      log(`\n--- what the text says (${summary.koalaRecords} koala records with a label) ---`);
      for (const [k, v] of Object.entries(summary.byCondition)) log(`  ${String(v).padStart(6)}  ${k}`);
      log(`  events:`);
      for (const [k, v] of Object.entries(summary.byEvent)) log(`  ${String(v).padStart(6)}  ${k}`);
      if (run.usage.requests > 0 && run.model) {
        log(`  usage: ${run.usage.requests} requests · ${run.usage.inputTokens} in / ${run.usage.outputTokens} out tokens`);
      }
      break;
    }
    case "evaluate": {
      const classifier = makeClassifier(classifierFrom(flags));
      const report = await evaluateClassifier(classifier);
      log(`\n=== synthetic corpus · ${report.classifier}${report.model ? ` (${report.model}, prompt ${report.promptVersion})` : ""} · taxonomy ${report.taxonomyVersion} ===`);
      log(`  ${report.passed}/${report.cases} cases pass in full (${pct(report.passRate)})`);
      log(`  by component: subject ${pct(report.byComponent.subject / report.cases)} · condition ${pct(report.byComponent.condition / report.cases)} · events ${pct(report.byComponent.events / report.cases)}`);
      log(`  by case type:`);
      for (const [type, b] of Object.entries(report.byCaseType)) {
        log(`    ${type.padEnd(20)} ${String(b.passed).padStart(2)}/${String(b.cases).padEnd(2)}  ${pct(b.passRate)}`);
      }
      log(`  events (precision / recall):`);
      for (const [e, s] of Object.entries(report.eventScores)) {
        log(`    ${e.padEnd(16)} ${pct(s.precision).padStart(6)} / ${pct(s.recall).padStart(6)}   tp ${s.tp} fp ${s.fp} fn ${s.fn}`);
      }
      if (report.failures.length) {
        log(`  failures:`);
        for (const f of report.failures) {
          log(`    [${f.id} ${f.caseType}] ${JSON.stringify(f.text)}`);
          log(`        expected ${f.expected.subject}/${f.expected.condition}/[${f.expected.events.join(",")}]`);
          log(`        actual   ${f.actual.subject}/${f.actual.condition}/[${f.actual.events.join(",")}]  evidence ${JSON.stringify(f.actual.evidence)}`);
        }
      }
      break;
    }
    case "synthesise":
    case "synthesize": {
      const key = arg1 ?? DEFAULT_HARVEST;
      const runId = await resolveRun(key, arg2);
      const family = await getFamily(key, runId);
      const s = await synthesiseFamily(family, {
        triggeredBy: { harvestKey: key, runId },
        force: flags.get("force") === "true",
        onProgress: log,
      });
      log(`\n=== ${s.familyKey} · ${s.model} · prompt ${s.promptVersion} · evidence ${s.evidenceHash.slice(0, 12)} (${s.metricCount} metrics) ===`);
      log(`\n${s.report.headline}\n`);
      for (const i of s.report.insights) {
        log(`[${i.kind} · value ${i.value}/5 · ${i.confidence}] ${i.title}`);
        log(`  ${i.essence}`);
        log(`  ${i.detail}`);
        if (i.caveat) log(`  caveat: ${i.caveat}`);
        log(`  evidence: ${i.evidence.join(", ")}`);
        if (i.checks.unknownCitations.length) log(`  !! unknown citations: ${i.checks.unknownCitations.join(", ")}`);
        if (i.checks.unverifiedNumbers.length) log(`  !! unverified numbers: ${i.checks.unverifiedNumbers.join(", ")}`);
        log("");
      }
      if (s.report.limitations.length) log(`limitations:\n  - ${s.report.limitations.join("\n  - ")}`);
      if (s.report.nextQuestions.length) log(`next questions:\n  - ${s.report.nextQuestions.join("\n  - ")}`);
      log(`\nusage: ${s.usage.inputTokens} in / ${s.usage.outputTokens} out tokens`);
      break;
    }
    case "union": {
      // Build (or confirm current) the portal's merged corpus for every window, so the first
      // visit to the portal does not have to. Stale summaries are recomputed; current ones are read.
      for (const scope of await listScopes()) {
        if (arg1 && scope.speciesKey !== arg1) continue;
        if (arg2 && scope.regionKey !== arg2) continue;
        const timeline = await getTimeline(scope.speciesKey, scope.regionKey);
        for (const y of timeline.years) {
          const u = y.union;
          log(`${y.year}: ${u.distinct} distinct (${u.duplicatesRemoved} duplicates removed), ${u.total.remarksRead} remarks read`);
        }
        for (const w of scope.windows.filter((w) => w.calendarYear === null)) {
          const { union: u } = await getWindowUnion(w.id);
          log(`${w.id}: ${u.distinct} distinct (${u.duplicatesRemoved} duplicates removed)`);
        }
      }
      break;
    }
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
      throw new Error(`unknown command "${command}" — use harvest | adapt | report | runs | classify | evaluate | synthesise | union`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
