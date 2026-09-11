/**
 * Threat and condition extraction from free text — shared shapes.
 *
 * Two classifiers implement one interface: a keyword baseline and an LLM. That symmetry is
 * deliberate and comes from the Week 3 direction — an ablation among LLM configurations
 * cannot show that an LLM was warranted at all, so the same taxonomy, the same inputs and the
 * same scorer run against a rule-based baseline.
 */

export type Subject = "koala" | "not_koala" | "unclear";

export type Condition = "alive_healthy" | "alive_unwell" | "dead" | "unknown";

export type EventCode =
  | "vehicle_strike"
  | "dog_attack"
  | "disease"
  | "injury"
  | "fire"
  | "rescue_or_care"
  | "with_joey";

export type TextField = "occurrenceRemarks" | "eventRemarks";

/** One unique piece of text to classify, already scrubbed of personal identifiers. */
export interface TextItem {
  /** sha256 of the scrubbed text. Identical remarks share a label and a classification call. */
  textHash: string;
  text: string;
}

export interface TextLabel {
  subject: Subject;
  condition: Condition;
  events: EventCode[];
  /** The classifier's own certainty, 0–1. Rules report a fixed value; the model reports its own. */
  confidence: number;
  /** A short quote from the text that supports the label. Withheld downstream where the text is. */
  evidence: string;
}

export interface ClassifierUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export type ClassifierKey = "keyword" | "llm";

export interface TextClassifier {
  key: ClassifierKey;
  /** Model id for model-backed classifiers, logged with every run. Null for rules. */
  model: string | null;
  promptVersion: string | null;
  classify(
    items: TextItem[],
    onProgress?: (message: string) => void,
  ): Promise<Map<string, TextLabel>>;
  usage(): ClassifierUsage;
}

/** One classifier's pass over one run: the labels, and which records they attach to. */
export interface ClassificationRun {
  harvestKey: string;
  runId: string;
  classifier: ClassifierKey;
  model: string | null;
  promptVersion: string | null;
  taxonomyVersion: string;
  startedAt: string;
  finishedAt: string;
  /** Distinct scrubbed texts seen in the corpus (both fields). */
  uniqueTexts: number;
  /** Of those, how many carry a label after this pass. Less than uniqueTexts when a limit was set. */
  labelledTexts: number;
  /** Records with at least one labelled field. */
  recordsCovered: number;
  usage: ClassifierUsage;
  labels: Record<string, TextLabel>;
  items: { recordId: string; field: TextField; textHash: string }[];
}
