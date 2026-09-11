import type { AdaptedRecord, FieldStatus } from "../canonical/record.ts";

/**
 * Corpus analysis: what Stage 1 is actually for.
 *
 * The field-coverage table exists to settle a question the whole LLM arm currently rests on as
 * an assumption — is there enough free text in ALA occurrence records to classify at all? If
 * there is not, that is a finding, and it reorders the sources rather than derailing anything.
 *
 * A plain populated/not-populated count would answer that question wrongly, and this was found
 * empirically rather than reasoned about: `occurrenceRemarks` is populated on ~58% of the
 * Stage 1 window, but sampled values include ",  K2" and "0" alongside "Looks strong and
 * healthy". Presence is not usefulness. So free text is additionally bucketed by substance,
 * and it is the substantive count — not the populated count — that the source-ordering
 * decision should be made on.
 */

export interface FieldCoverage {
  canonicalField: string;
  /** Source fields the adapter consults for this canonical field. */
  sourceFields: string[];
  counts: Record<FieldStatus, number>;
  /** Records carrying a usable value (mapped + derived). */
  populated: number;
  total: number;
  /** populated / total, 0–1. */
  coverage: number;
}

/**
 * Substance bands for free text. The thresholds are arbitrary and are stated rather than
 * hidden, because the honest version of this measurement is one whose cutoffs a reader can
 * disagree with.
 */
export type TextBand = "absent" | "trivial" | "short" | "substantive";

export interface FreeTextCoverage {
  canonicalField: string;
  total: number;
  bands: Record<TextBand, number>;
  /** Share of the corpus with text worth sending to a classifier at all. */
  substantiveShare: number;
  medianLength: number;
  maxLength: number;
  /** Illustrative values, shortest first, so the reader can judge the bands themselves. */
  samples: { band: TextBand; value: string }[];
}

export interface UnmappedFieldCount {
  field: string;
  /** How many records carried this source field without any mapping consuming it. */
  records: number;
  share: number;
  exampleValue: unknown;
}

export interface ResourceBreakdown {
  dataResourceUid: string | null;
  dataResourceName: string;
  records: number;
  share: number;
  /** Free-text substance within this resource — where the usable text actually comes from. */
  substantiveRemarks: number;
  /**
   * Coordinate uncertainty in metres, where supplied.
   *
   * Both are reported because the mean alone misleads: iNaturalist's distribution is bimodal —
   * a median of 16m (phone GPS) alongside a tail at ~28km where threatened-species locations
   * are deliberately obscured. The mean lands at ~3,656m, describing neither group.
   */
  meanCoordinateUncertainty: number | null;
  medianCoordinateUncertainty: number | null;
  /** Records whose uncertainty exceeds 10km — the obscuring signature, counted rather than averaged. */
  obscuredRecords: number;
}

/**
 * A field the source supplies that the canonical record deliberately does not keep. Surfaced
 * as a summary so the decision to narrow the record stays visible and reversible, rather than
 * becoming an undocumented gap someone rediscovers in three months.
 */
export interface ExcludedFieldSummary {
  field: string;
  reason: string;
  /** How many records actually carry a value for it — the cost of leaving it out. */
  records: number;
  share: number;
  exampleValue: unknown;
}

export interface ValidationSummary {
  code: string;
  severity: string;
  count: number;
  message: string;
}

export interface CorpusAnalysis {
  harvestKey: string;
  runId: string;
  totalRecords: number;
  validRecords: number;
  fields: FieldCoverage[];
  freeText: FreeTextCoverage[];
  unmappedSourceFields: UnmappedFieldCount[];
  excludedSourceFields: ExcludedFieldSummary[];
  resources: ResourceBreakdown[];
  validation: ValidationSummary[];
  /** Distinct source-supplied assertions and how often each fires. */
  sourceAssertions: { assertion: string; count: number; share: number }[];
}

const FREE_TEXT_FIELDS = ["occurrenceRemarks", "eventRemarks"] as const;

export function bandText(value: string | null): TextBand {
  if (value === null) return "absent";
  const trimmed = value.trim();
  if (trimmed === "") return "absent";
  // Words of two or more letters — "0" and ", K2" have none and must not count as text.
  const words = trimmed.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length === 0 || trimmed.length < 3) return "trivial";
  if (trimmed.length < 20 || words.length < 3) return "short";
  return "substantive";
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

export function analyseCorpus(
  harvestKey: string,
  runId: string,
  records: AdaptedRecord[],
): CorpusAnalysis {
  const total = records.length;
  const safeShare = (n: number) => (total === 0 ? 0 : n / total);

  // --- Field coverage, read off the traces rather than off the records ---
  // Reading the trace means a field that was present-but-rejected is distinguishable from one
  // the source never sent, which is the distinction that makes the table actionable.
  const fieldMap = new Map<string, FieldCoverage>();
  for (const { trace } of records) {
    for (const f of trace.fields) {
      let entry = fieldMap.get(f.canonicalField);
      if (!entry) {
        entry = {
          canonicalField: f.canonicalField,
          sourceFields: f.sourceFields,
          counts: {
            mapped: 0,
            derived: 0,
            empty_in_source: 0,
            absent_from_source: 0,
            rejected: 0,
          },
          populated: 0,
          total: 0,
          coverage: 0,
        };
        fieldMap.set(f.canonicalField, entry);
      }
      entry.counts[f.status]++;
      entry.total++;
      if (f.status === "mapped" || f.status === "derived") entry.populated++;
    }
  }
  const fields = [...fieldMap.values()]
    .map((f) => ({ ...f, coverage: f.total === 0 ? 0 : f.populated / f.total }))
    .sort((a, b) => b.coverage - a.coverage || a.canonicalField.localeCompare(b.canonicalField));

  // --- Free-text substance ---
  const freeText: FreeTextCoverage[] = FREE_TEXT_FIELDS.map((field) => {
    const bands: Record<TextBand, number> = { absent: 0, trivial: 0, short: 0, substantive: 0 };
    const lengths: number[] = [];
    const samples = new Map<TextBand, string>();

    for (const { record } of records) {
      const value = record[field] as string | null;
      const band = bandText(value);
      bands[band]++;
      if (value) {
        lengths.push(value.trim().length);
        if (!samples.has(band)) samples.set(band, value.trim().slice(0, 160));
      }
    }

    return {
      canonicalField: field,
      total,
      bands,
      substantiveShare: safeShare(bands.substantive),
      medianLength: median(lengths),
      maxLength: lengths.length > 0 ? Math.max(...lengths) : 0,
      samples: (["trivial", "short", "substantive"] as TextBand[])
        .filter((b) => samples.has(b))
        .map((b) => ({ band: b, value: samples.get(b)! })),
    };
  });

  // --- Source fields nothing consumed: the schema's blind spot ---
  const unmappedMap = new Map<string, { records: number; exampleValue: unknown }>();
  for (const { trace } of records) {
    for (const u of trace.unmappedSourceFields) {
      const entry = unmappedMap.get(u.field) ?? { records: 0, exampleValue: u.value };
      entry.records++;
      unmappedMap.set(u.field, entry);
    }
  }
  const unmappedSourceFields = [...unmappedMap.entries()]
    .map(([field, v]) => ({ field, records: v.records, share: safeShare(v.records), exampleValue: v.exampleValue }))
    .sort((a, b) => b.records - a.records);

  // --- Deliberately excluded fields: the menu for widening the record later ---
  const excludedMap = new Map<string, { reason: string; records: number; exampleValue: unknown }>();
  for (const { trace } of records) {
    for (const e of trace.excludedSourceFields) {
      const entry =
        excludedMap.get(e.field) ?? { reason: e.reason, records: 0, exampleValue: e.value };
      entry.records++;
      excludedMap.set(e.field, entry);
    }
  }
  const excludedSourceFields: ExcludedFieldSummary[] = [...excludedMap.entries()]
    .map(([field, v]) => ({
      field,
      reason: v.reason,
      records: v.records,
      share: safeShare(v.records),
      exampleValue: v.exampleValue,
    }))
    .sort((a, b) => b.records - a.records);

  // --- Contributing data resources: a fragmentation measurement in its own right ---
  const resourceMap = new Map<
    string,
    { uid: string | null; name: string; records: number; substantive: number; uncertainties: number[] }
  >();
  for (const { record } of records) {
    const name = record.provenance.dataResourceName ?? "(unattributed)";
    const key = record.provenance.dataResourceUid ?? name;
    const entry =
      resourceMap.get(key) ??
      { uid: record.provenance.dataResourceUid, name, records: 0, substantive: 0, uncertainties: [] };
    entry.records++;
    if (bandText(record.occurrenceRemarks) === "substantive") entry.substantive++;
    if (record.coordinateUncertaintyInMeters !== null) {
      entry.uncertainties.push(record.coordinateUncertaintyInMeters);
    }
    resourceMap.set(key, entry);
  }
  const resources: ResourceBreakdown[] = [...resourceMap.values()]
    .map((r) => ({
      dataResourceUid: r.uid,
      dataResourceName: r.name,
      records: r.records,
      share: safeShare(r.records),
      substantiveRemarks: r.substantive,
      meanCoordinateUncertainty:
        r.uncertainties.length === 0
          ? null
          : r.uncertainties.reduce((a, b) => a + b, 0) / r.uncertainties.length,
      medianCoordinateUncertainty: r.uncertainties.length === 0 ? null : median(r.uncertainties),
      obscuredRecords: r.uncertainties.filter((u) => u > 10_000).length,
    }))
    .sort((a, b) => b.records - a.records);

  // --- Validation issues ---
  const validationMap = new Map<string, ValidationSummary>();
  for (const { trace } of records) {
    for (const issue of trace.validationIssues) {
      const entry =
        validationMap.get(issue.code) ??
        { code: issue.code, severity: issue.severity, count: 0, message: issue.message };
      entry.count++;
      validationMap.set(issue.code, entry);
    }
  }
  const validation = [...validationMap.values()].sort((a, b) => b.count - a.count);

  // --- Source-supplied assertions: ALA's own view of its data quality ---
  const assertionMap = new Map<string, number>();
  for (const { record } of records) {
    for (const a of record.sourceAssertions) {
      assertionMap.set(a, (assertionMap.get(a) ?? 0) + 1);
    }
  }
  const sourceAssertions = [...assertionMap.entries()]
    .map(([assertion, count]) => ({ assertion, count, share: safeShare(count) }))
    .sort((a, b) => b.count - a.count);

  return {
    harvestKey,
    runId,
    totalRecords: total,
    validRecords: records.filter((r) => r.record.isValid).length,
    fields,
    freeText,
    unmappedSourceFields,
    excludedSourceFields,
    resources,
    validation,
    sourceAssertions,
  };
}
