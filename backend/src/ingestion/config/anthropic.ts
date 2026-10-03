import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place the Anthropic key is read.
 *
 * Either name works: ANTHROPIC_API_KEY is what the SDK looks for on its own, CLAUDE_API_KEY is
 * the name this project's .env uses. The key never leaves the process and is never logged;
 * the model id, by contrast, is written into every result so a run can be reproduced.
 */
export function anthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export const anthropicConfigured = (): boolean => anthropicApiKey() !== null;

/**
 * The model the AI arm runs on: Claude Opus 5.5. ANALYSIS_MODEL overrides it; whichever is in force
 * is written into every run (analysis.runs.model), never assumed.
 *
 * Verified 3 Oct 2026 against the live Models API: `claude-opus-5-5`, "Claude Opus 5.5", 1M input
 * tokens, 128K output. What that means for calls made here:
 *  - `temperature` is rejected (400) — `createDeterministic` falls back without it;
 *  - thinking is always adaptive and cannot be disabled; depth is set with `output_config.effort`,
 *    whose default on this model is `medium`, so callers set it explicitly;
 *  - forced `tool_choice` (`any` / `tool`) is rejected — use `auto` and say which tool in the prompt.
 */
export const AI_MODEL = process.env.ANALYSIS_MODEL?.trim() || "claude-opus-5-5";

/** Models that have refused the temperature parameter this process; learned, not listed. */
const rejectsTemperature = new Set<string>();

/**
 * One message call with the deterministic settings this project commits to, as far as the
 * model allows them. Temperature 0 is sent where the model accepts it; the Claude 5 tier,
 * Opus 5.5 included, rejects the parameter outright (verified 11 Sep 2026 on Opus 5: "`temperature`
 * is deprecated for this model"), in which case the call is retried without it and the result says
 * so. Determinism then rests on the fixed prompt and tool definitions — which is why the AI arm's
 * run-to-run consistency is measured rather than assumed — and the run records which case applied
 * rather than claiming a setting that was never in force.
 */
export async function createDeterministic(
  client: Anthropic,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "temperature">,
): Promise<{ response: Anthropic.Message; temperature: number | null }> {
  if (!rejectsTemperature.has(params.model)) {
    try {
      return { response: await client.messages.create({ ...params, temperature: 0 }), temperature: 0 };
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError && /temperature/i.test(error.message)) {
        rejectsTemperature.add(params.model);
      } else {
        throw error;
      }
    }
  }
  return { response: await client.messages.create(params), temperature: null };
}

export function makeAnthropic(): Anthropic {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    throw new Error(
      "No Anthropic key. Put CLAUDE_API_KEY (or ANTHROPIC_API_KEY) in backend/.env — never committed.",
    );
  }
  // The SDK's own retry handles rate limits and transient errors. Its default per-request
  // timeout is ten minutes, which with retries turned one stalled connection (a laptop going
  // to sleep mid-run) into an hour of waiting; two minutes is generous for any call made here.
  return new Anthropic({ apiKey, maxRetries: 4, timeout: 120_000 });
}
