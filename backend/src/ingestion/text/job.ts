import { bandText } from "../analysis/coverage.ts";
import { recordStore } from "../store/recordStore.ts";
import { sha256 } from "../snapshot/store.ts";
import { KeywordClassifier } from "./keyword.ts";
import { AnthropicClassifier } from "./llm.ts";
import { readClassificationRun, writeClassificationRun } from "./store.ts";
import { scrubForModel } from "./scrub.ts";
import { TAXONOMY_VERSION } from "./taxonomy.ts";
import type {
  ClassificationRun,
  ClassifierKey,
  TextClassifier,
  TextField,
  TextItem,
  TextLabel,
} from "./types.ts";

/**
 * Classify the free text of one run.
 *
 * What gets classified: every substantive remark (three or more words, twenty or more
 * characters — the same band the corpus statistics use), scrubbed of identifiers first. Texts
 * are de-duplicated by hash before anything is sent anywhere: "Reported to hotline" appears
 * on hundreds of records and is classified once.
 *
 * Resumable. A previous pass by the same classifier under the same taxonomy and prompt
 * version is reused for every text it already labelled, so a run interrupted by a rate limit
 * or a cost cap continues rather than restarts, and `--limit` bounds how many *new* texts a
 * single invocation will spend on.
 */
const TEXT_FIELDS: TextField[] = ["occurrenceRemarks", "eventRemarks"];
/** Unique texts between run-file checkpoints: five model requests' worth. */
const CHECKPOINT_EVERY = 100;

export function makeClassifier(key: ClassifierKey): TextClassifier {
  return key === "llm" ? new AnthropicClassifier() : new KeywordClassifier();
}

export interface ClassifyOptions {
  /** Maximum number of not-yet-labelled unique texts to classify in this invocation. */
  limit?: number;
  /** Ignore any previous pass and relabel everything. */
  force?: boolean;
  onProgress?: (message: string) => void;
}

export async function classifyRun(
  harvestKey: string,
  runId: string,
  classifier: TextClassifier,
  options: ClassifyOptions = {},
): Promise<ClassificationRun> {
  const log = options.onProgress ?? (() => {});
  const startedAt = new Date().toISOString();
  const records = await recordStore.load(harvestKey, runId);

  // Collect the unique substantive texts and which record fields carry them.
  const texts = new Map<string, TextItem>();
  const items: ClassificationRun["items"] = [];
  let redactions = 0;
  for (const { record } of records) {
    for (const field of TEXT_FIELDS) {
      const value = record[field];
      if (bandText(value) !== "substantive") continue;
      const scrubbed = scrubForModel(value!);
      redactions += scrubbed.redactions;
      const textHash = sha256(scrubbed.text);
      texts.set(textHash, { textHash, text: scrubbed.text });
      items.push({ recordId: record.recordId, field, textHash });
    }
  }

  // Reuse an earlier pass where its provenance matches exactly.
  const previous = options.force ? null : await readClassificationRun(harvestKey, runId, classifier.key);
  const reusable =
    previous &&
    previous.taxonomyVersion === TAXONOMY_VERSION &&
    previous.promptVersion === classifier.promptVersion &&
    previous.model === classifier.model
      ? previous.labels
      : {};

  const labels: Record<string, TextLabel> = {};
  const pending: TextItem[] = [];
  for (const [hash, item] of texts) {
    if (reusable[hash]) labels[hash] = reusable[hash];
    else pending.push(item);
  }
  const toClassify = options.limit !== undefined ? pending.slice(0, options.limit) : pending;

  log(
    `classify ${harvestKey}/${runId} with ${classifier.key}${classifier.model ? ` (${classifier.model}, prompt ${classifier.promptVersion})` : ""}`,
  );
  log(
    `  ${records.length} records · ${items.length} substantive fields · ${texts.size} unique texts · ` +
      `${Object.keys(labels).length} reused · ${toClassify.length} to classify` +
      (pending.length > toClassify.length ? ` (${pending.length - toClassify.length} deferred by --limit)` : "") +
      ` · ${redactions} identifiers scrubbed`,
  );

  // Token usage is cumulative across resumed invocations, so the run file reports what the
  // whole pass cost rather than only the last session of it.
  const priorUsage = previous && Object.keys(reusable).length > 0 ? previous.usage : { requests: 0, inputTokens: 0, outputTokens: 0 };
  const buildRun = (): ClassificationRun => {
    const used = classifier.usage();
    const covered = new Set(items.filter((i) => labels[i.textHash]).map((i) => i.recordId));
    return {
      harvestKey,
      runId,
      classifier: classifier.key,
      model: classifier.model,
      promptVersion: classifier.promptVersion,
      temperature: classifier.temperature,
      taxonomyVersion: TAXONOMY_VERSION,
      startedAt,
      finishedAt: new Date().toISOString(),
      uniqueTexts: texts.size,
      labelledTexts: Object.keys(labels).length,
      recordsCovered: covered.size,
      usage: {
        requests: priorUsage.requests + used.requests,
        inputTokens: priorUsage.inputTokens + used.inputTokens,
        outputTokens: priorUsage.outputTokens + used.outputTokens,
      },
      labels,
      items,
    };
  };

  // Checkpoint as it goes. A model pass over a year is hundreds of requests, and a stalled
  // connection part-way through should cost the texts since the last checkpoint, not the run.
  if (toClassify.length > 0) {
    for (let start = 0; start < toClassify.length; start += CHECKPOINT_EVERY) {
      const chunk = toClassify.slice(start, start + CHECKPOINT_EVERY);
      const fresh = await classifier.classify(chunk, log);
      for (const [hash, label] of fresh) labels[hash] = label;
      if (start + CHECKPOINT_EVERY < toClassify.length) {
        await writeClassificationRun(buildRun());
        log(`  checkpoint: ${Object.keys(labels).length}/${texts.size} texts saved`);
      }
    }
  }

  const run = buildRun();
  const written = await writeClassificationRun(run);
  log(`  wrote ${written}: ${run.labelledTexts}/${run.uniqueTexts} texts labelled, ${run.recordsCovered} records covered`);
  return run;
}
