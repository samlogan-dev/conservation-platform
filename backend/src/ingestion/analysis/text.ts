import type { StoredRecord } from "../canonical/record.ts";
import { CONDITION_RANK, CONDITION_CODES, EVENT_CODES, SUBJECT_CODES } from "../text/taxonomy.ts";
import type { ClassificationRun, Condition, EventCode, Subject, TextLabel } from "../text/types.ts";

/**
 * What the classified text says about a run, as counts.
 *
 * Counted per record, not per text: a record with both remark fields labelled gets one
 * combined label — the worse condition, the union of events — so a koala is not counted dead
 * twice because two fields said so.
 */

export interface RecordLabel {
  recordId: string;
  subject: Subject;
  condition: Condition;
  events: EventCode[];
  confidence: number;
}

export interface TextSummary {
  classifier: ClassificationRun["classifier"];
  model: string | null;
  promptVersion: string | null;
  taxonomyVersion: string;
  finishedAt: string;
  uniqueTexts: number;
  labelledTexts: number;
  recordsCovered: number;
  /** Records with a label whose subject is koala — the denominator for the rates below. */
  koalaRecords: number;
  usage: ClassificationRun["usage"];
  bySubject: Record<Subject, number>;
  byCondition: Record<Condition, number>;
  byEvent: Record<EventCode, number>;
  byDataset: {
    dataResourceUid: string | null;
    dataResourceName: string;
    records: number;
    dead: number;
    unwell: number;
    events: Record<EventCode, number>;
  }[];
  byMonth: {
    month: string;
    records: number;
    dead: number;
    unwell: number;
    vehicle_strike: number;
    dog_attack: number;
    disease: number;
    fire: number;
  }[];
  /** Agreement with another classifier over the texts both labelled, when one exists. */
  agreement: {
    with: ClassificationRun["classifier"];
    texts: number;
    subject: number;
    condition: number;
    events: number;
  } | null;
}

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** One label per record, combining the fields it carried. */
export function labelRecords(run: ClassificationRun): Map<string, RecordLabel> {
  const out = new Map<string, RecordLabel>();
  for (const item of run.items) {
    const label: TextLabel | undefined = run.labels[item.textHash];
    if (!label) continue;
    const existing = out.get(item.recordId);
    if (!existing) {
      out.set(item.recordId, {
        recordId: item.recordId,
        subject: label.subject,
        condition: label.condition,
        events: [...label.events],
        confidence: label.confidence,
      });
      continue;
    }
    if (CONDITION_RANK[label.condition] > CONDITION_RANK[existing.condition]) existing.condition = label.condition;
    for (const e of label.events) if (!existing.events.includes(e)) existing.events.push(e);
    if (existing.subject === "unclear") existing.subject = label.subject;
    existing.confidence = Math.min(existing.confidence, label.confidence);
  }
  return out;
}

export function summariseText(
  records: StoredRecord[],
  run: ClassificationRun,
  other: ClassificationRun | null,
): TextSummary {
  const labels = labelRecords(run);
  const byId = new Map(records.map((r) => [r.record.recordId, r.record]));

  const bySubject = zero(SUBJECT_CODES);
  const byCondition = zero(CONDITION_CODES);
  const byEvent = zero(EVENT_CODES);
  const datasetMap = new Map<string, TextSummary["byDataset"][number]>();
  const monthMap = new Map<string, TextSummary["byMonth"][number]>();
  let koalaRecords = 0;

  for (const label of labels.values()) {
    const record = byId.get(label.recordId);
    if (!record) continue;
    bySubject[label.subject]++;
    if (label.subject !== "koala") continue;
    koalaRecords++;
    byCondition[label.condition]++;
    for (const e of label.events) byEvent[e]++;

    const dKey = record.provenance.dataResourceUid ?? record.provenance.dataResourceName ?? "(unattributed)";
    const dataset =
      datasetMap.get(dKey) ??
      {
        dataResourceUid: record.provenance.dataResourceUid,
        dataResourceName: record.provenance.dataResourceName ?? "(unattributed)",
        records: 0,
        dead: 0,
        unwell: 0,
        events: zero(EVENT_CODES),
      };
    dataset.records++;
    if (label.condition === "dead") dataset.dead++;
    if (label.condition === "alive_unwell") dataset.unwell++;
    for (const e of label.events) dataset.events[e]++;
    datasetMap.set(dKey, dataset);

    const month = record.eventDate ? record.eventDate.slice(0, 7) : "unknown";
    const m =
      monthMap.get(month) ??
      { month, records: 0, dead: 0, unwell: 0, vehicle_strike: 0, dog_attack: 0, disease: 0, fire: 0 };
    m.records++;
    if (label.condition === "dead") m.dead++;
    if (label.condition === "alive_unwell") m.unwell++;
    for (const e of label.events) {
      if (e === "vehicle_strike" || e === "dog_attack" || e === "disease" || e === "fire") m[e]++;
    }
    monthMap.set(month, m);
  }

  let agreement: TextSummary["agreement"] = null;
  if (other) {
    let texts = 0;
    let subject = 0;
    let condition = 0;
    let events = 0;
    for (const [hash, a] of Object.entries(run.labels)) {
      const b = other.labels[hash];
      if (!b) continue;
      texts++;
      if (a.subject === b.subject) subject++;
      if (a.condition === b.condition) condition++;
      const ea = [...a.events].sort().join(",");
      const eb = [...b.events].sort().join(",");
      if (ea === eb) events++;
    }
    agreement = { with: other.classifier, texts, subject, condition, events };
  }

  return {
    classifier: run.classifier,
    model: run.model,
    promptVersion: run.promptVersion,
    taxonomyVersion: run.taxonomyVersion,
    finishedAt: run.finishedAt,
    uniqueTexts: run.uniqueTexts,
    labelledTexts: run.labelledTexts,
    recordsCovered: run.recordsCovered,
    koalaRecords,
    usage: run.usage,
    bySubject,
    byCondition,
    byEvent,
    byDataset: [...datasetMap.values()].sort((a, b) => b.records - a.records),
    byMonth: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    agreement,
  };
}
