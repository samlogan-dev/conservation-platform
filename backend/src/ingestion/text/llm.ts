import Anthropic from "@anthropic-ai/sdk";
import { CONDITION_CODES, EVENT_CODES, SUBJECT_CODES } from "./taxonomy.ts";
import { CLASSIFICATION_TOOL, PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage } from "./prompt.ts";
import type {
  ClassifierUsage,
  Condition,
  EventCode,
  Subject,
  TextClassifier,
  TextItem,
  TextLabel,
} from "./types.ts";

/**
 * The model-backed classifier, on the cheap tier by default.
 *
 * Deterministic settings (temperature 0), the model id read from the environment and logged
 * with every run, and the output forced through a tool schema. Remarks go up in batches so a
 * corpus of tens of thousands of unique texts is thousands of requests rather than tens of
 * thousands. The SDK's own retry handles rate limits and transient errors.
 *
 * `claude-haiku-4-5` is the complete model id: current Anthropic ids carry no date suffix.
 * Override with TEXT_MODEL to compare tiers; the comparison is the point of the interface.
 */
const DEFAULT_MODEL = "claude-haiku-4-5";
const BATCH_SIZE = 20;

const asEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

export class AnthropicClassifier implements TextClassifier {
  readonly key = "llm" as const;
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;
  private readonly client: Anthropic;
  private readonly used: ClassifierUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  constructor(model?: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Put it in backend/.env (never committed) or use --classifier keyword.",
      );
    }
    this.model = model ?? process.env.TEXT_MODEL ?? DEFAULT_MODEL;
    this.client = new Anthropic({ maxRetries: 4 });
  }

  usage(): ClassifierUsage {
    return { ...this.used };
  }

  async classify(
    items: TextItem[],
    onProgress: (message: string) => void = () => {},
  ): Promise<Map<string, TextLabel>> {
    const out = new Map<string, TextLabel>();
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      const labels = await this.classifyBatch(batch);
      for (const [hash, label] of labels) out.set(hash, label);
      onProgress(
        `  ${Math.min(start + BATCH_SIZE, items.length)}/${items.length} texts · ` +
          `${this.used.requests} requests · ${this.used.inputTokens} in / ${this.used.outputTokens} out tokens`,
      );
    }
    return out;
  }

  private async classifyBatch(batch: TextItem[]): Promise<Map<string, TextLabel>> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: [CLASSIFICATION_TOOL],
      tool_choice: { type: "tool", name: CLASSIFICATION_TOOL.name },
      messages: [{ role: "user", content: buildUserMessage(batch.map((b) => b.text)) }],
    });

    this.used.requests++;
    this.used.inputTokens += response.usage.input_tokens;
    this.used.outputTokens += response.usage.output_tokens;

    const call = response.content.find((c) => c.type === "tool_use");
    const results = (call && call.type === "tool_use" ? (call.input as { results?: unknown[] }).results : undefined) ?? [];

    const out = new Map<string, TextLabel>();
    for (const raw of results) {
      const r = raw as Record<string, unknown>;
      const index = typeof r.index === "number" ? r.index : -1;
      const item = batch[index];
      if (!item) continue;
      const events = Array.isArray(r.events)
        ? [...new Set(r.events.map((e) => asEnum<EventCode>(e, EVENT_CODES, "injury")).filter((e) => (EVENT_CODES as string[]).includes(e)))]
        : [];
      out.set(item.textHash, {
        subject: asEnum<Subject>(r.subject, SUBJECT_CODES, "unclear"),
        condition: asEnum<Condition>(r.condition, CONDITION_CODES, "unknown"),
        events,
        confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
        evidence: typeof r.evidence === "string" ? r.evidence.slice(0, 120) : "",
      });
    }

    // A remark the model skipped is recorded as unclear rather than silently dropped, so the
    // count of labelled texts stays honest and a rerun can target it.
    for (const item of batch) {
      if (!out.has(item.textHash)) {
        out.set(item.textHash, { subject: "unclear", condition: "unknown", events: [], confidence: 0, evidence: "" });
      }
    }
    return out;
  }
}
