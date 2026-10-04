import "dotenv/config";
import { closeDb } from "../db/pool.ts";
import { CALCULATED_PARAMS } from "./params.ts";
import { type Insight, finishRun, insertInsights, startRun } from "./runs.ts";
import { silentSpecies } from "./calculated/silentSpecies.ts";
import { rangeChange } from "./calculated/rangeChange.ts";
import { notableRecords } from "./calculated/notableRecords.ts";
import { reportingRate } from "./calculated/reportingRate.ts";
import { AI_PARAMS, measureOpening, runAiArm } from "./ai/agent.ts";
import { PROMPT_VERSION, briefText, systemPrompt, type Brief } from "./ai/prompt.ts";
import { AI_MODEL } from "../ingestion/config/anthropic.ts";
import { scoreRun } from "./compare/score.ts";
import { db } from "../db/pool.ts";

/**
 * Analysis CLI.
 *
 *   npm run analyse -- calculated [1,2,3,5]         run the calculated arm for the given insights (default all built)
 *   npm run analyse -- ai-prompt <guided|open>      print the system prompt and brief (no API call)
 *   npm run analyse -- ai-estimate                  measure the fixed opening with count_tokens (free) and estimate cost
 *   npm run analyse -- ai <guided|open> [--repeat N] --confirm-spend   run the AI arm (paid)
 *   npm run analyse -- compare <aiRunId> [calculatedRunId]   score an AI run (default: latest calculated run)
 *
 * Each invocation is one row in analysis.runs, carrying the parameters and the exact corpus it read.
 */
const CALCULATED: Record<string, { label: string; run: () => Promise<Insight[]> }> = {
  "1": { label: "silent species and evidence gaps", run: silentSpecies },
  "2": { label: "range change", run: rangeChange },
  "3": { label: "reporting-rate trend", run: reportingRate },
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
  const args = process.argv.slice(2);
  const [command, list] = args.filter((a) => !a.startsWith("--"));
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : "true");
  };
  const brief = (b: string | undefined): Brief => {
    if (b !== "guided" && b !== "open") throw new Error('brief must be "guided" or "open"');
    return b;
  };
  switch (command) {
    case "ai-prompt":
      console.log(await systemPrompt());
      console.log("\n===== brief =====\n");
      console.log(briefText(brief(list)));
      break;
    case "ai-estimate": {
      const p = AI_PARAMS.pricePerMTok;
      console.log(`${AI_MODEL}, prompt ${PROMPT_VERSION}, effort ${AI_PARAMS.effort}, caps: ${AI_PARAMS.maxTurns} turns / $${AI_PARAMS.maxCostUsd}`);
      for (const b of ["guided", "open"] as const) {
        const opening = await measureOpening(b);
        // A rough envelope, not a quote: T turns, the conversation growing by G tokens per turn
        // (tool results plus the assistant's own turn), O output tokens per turn. History is re-read
        // from cache each turn; each turn's new tokens are written to cache once.
        for (const [label, T, G, O] of [["light", 25, 2_500, 1_500], ["heavy", 60, 4_000, 2_500]] as const) {
          let cacheRead = 0, cacheWrite = opening, ctx = opening;
          for (let t = 1; t <= T; t++) { cacheRead += ctx; cacheWrite += G; ctx += G; }
          const cost = (cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + T * O * p.output) / 1e6;
          console.log(`  ${b.padEnd(6)} opening ${opening} tokens · ${label.padEnd(5)} (${T} turns, +${G}/turn, ${O} out/turn): ends at ~${Math.round(ctx / 1000)}k context, ~$${cost.toFixed(2)}`);
        }
      }
      break;
    }
    case "ai": {
      if (flag("confirm-spend") !== "true") throw new Error("AI runs call a paid API — re-run with --confirm-spend");
      const repeat = Number(flag("repeat") ?? 1);
      let failed = 0;
      for (let i = 1; i <= repeat; i++) {
        // A failed run is recorded as failed in analysis.runs; the batch carries on.
        try {
          const s = await runAiArm(brief(list), { onProgress: (m) => console.log(m) });
          console.log(`run ${i}/${repeat} ${s.runId}: ${s.turns} turns, ${s.queries} queries, ${s.insights} insights, stop=${s.stopReason}, ~$${s.estimatedCostUsd.toFixed(2)}`);
        } catch (error) {
          failed++;
          console.error(`run ${i}/${repeat} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failed) throw new Error(`${failed} of ${repeat} runs failed`);
      break;
    }
    case "compare": {
      if (!list) throw new Error("compare needs an AI run id");
      const calcId = args.filter((a) => !a.startsWith("--"))[2] ??
        (await db().query<{ run_id: string }>("select run_id from analysis.runs where arm = 'calculated' and status = 'done' order by started_at desc limit 1")).rows[0]?.run_id;
      if (!calcId) throw new Error("no completed calculated run to compare against");
      const { summary } = await scoreRun(list, calcId);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }
    case "calculated":
      await runCalculated(list ? list.split(",").map((s) => s.trim()) : Object.keys(CALCULATED));
      break;
    default:
      throw new Error(`unknown command "${command}" — use: calculated | ai-prompt | ai-estimate | ai | compare`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
