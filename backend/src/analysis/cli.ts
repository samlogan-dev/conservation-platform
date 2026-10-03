import "dotenv/config";
import { closeDb } from "../db/pool.ts";
import { CALCULATED_PARAMS } from "./params.ts";
import { type Insight, finishRun, insertInsights, startRun } from "./runs.ts";
import { silentSpecies } from "./calculated/silentSpecies.ts";
import { rangeChange } from "./calculated/rangeChange.ts";
import { notableRecords } from "./calculated/notableRecords.ts";

/**
 * Analysis CLI.
 *
 *   npm run analyse -- calculated [1,2,5]   run the calculated arm for the given insights (default all built)
 *
 * Each invocation is one row in analysis.runs, carrying the parameters and the exact corpus it read.
 */
const CALCULATED: Record<string, { label: string; run: () => Promise<Insight[]> }> = {
  "1": { label: "silent species and evidence gaps", run: silentSpecies },
  "2": { label: "range change", run: rangeChange },
  "5": { label: "notable records", run: notableRecords },
};

async function runCalculated(which: string[]): Promise<void> {
  const runId = await startRun({ arm: "calculated", params: { ...CALCULATED_PARAMS, insights: which } });
  console.log(`calculated run ${runId} — insights ${which.join(", ")}`);
  try {
    for (const key of which) {
      const insight = CALCULATED[key];
      if (!insight) throw new Error(`no calculated insight #${key} — built: ${Object.keys(CALCULATED).join(", ")}`);
      const started = Date.now();
      const results = await insight.run();
      await insertInsights(runId, results);
      console.log(`  #${key} ${insight.label}: ${results.length} insights in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    await finishRun(runId, { status: "done" });
  } catch (error) {
    await finishRun(runId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, list] = process.argv.slice(2);
  switch (command) {
    case "calculated":
      await runCalculated(list ? list.split(",").map((s) => s.trim()) : Object.keys(CALCULATED));
      break;
    default:
      throw new Error(`unknown command "${command}" — use: calculated [1,2,5]`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
