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

/**
 * Incremental corpus analysis: records are added one at a time as they are adapted and the
 * summary is produced at the end. Accumulating rather than taking the whole corpus at once is
 * what lets a year of 77,000 records be analysed without ever holding its traces in memory.
 */
export class CorpusAnalyser {
  private total = 0;
  private valid = 0;
  private readonly fieldMap = new Map<string, FieldCoverage>();
  private readonly text = new Map<
    (typeof FREE_TEXT_FIELDS)[number],
    { bands: Record<TextBand, number>; lengths: number[]; samples: Map<TextBand, string> }
  >();
  private readonly unmappedMap = new Map<string, { records: number; exampleValue: unknown }>();
  private readonly excludedMap = new Map<string, { reason: string; records: number; exampleValue: unknown }>();
  private readonly resourceMap = new Map<
    string,
    { uid: string | null; name: string; records: number; substantive: number; uncertainties: number[] }
  >();
  private readonly validationMap = new Map<string, ValidationSummary>();
  private readonly assertionMap = new Map<string, number>();

  constructor() {
    for (const field of FREE_TEXT_FIELDS) {
      this.text.set(field, {
        bands: { absent: 0, trivial: 0, short: 0, substantive: 0 },
        lengths: [],
        samples: new Map(),
      });
    }
  }

  add({ record, trace }: AdaptedRecord): void {
    this.total++;
    if (record.isValid) this.valid++;

    // --- Field coverage, read off the trace rather than off the record ---
    // Reading the trace means a field that was present-but-rejected is distinguishable from
    // one the source never sent, which is the distinction that makes the table actionable.
    for (const f of trace.fields) {
      let entry = this.fieldMap.get(f.canonicalField);
      if (!entry) {
        entry = {
          canonicalField: f.canonicalField,
          sourceFields: f.sourceFields,
          counts: { mapped: 0, derived: 0, empty_in_source: 0, absent_from_source: 0, rejected: 0 },
          populated: 0,
          total: 0,
          coverage: 0,
        };
        this.fieldMap.set(f.canonicalField, entry);
      }
      entry.counts[f.status]++;
      entry.total++;
      if (f.status === "mapped" || f.status === "derived") entry.populated++;
    }

    // --- Free-text substance ---
    for (const field of FREE_TEXT_FIELDS) {
      const t = this.text.get(field)!;
      const value = record[field];
      const band = bandText(value);
      t.bands[band]++;
      if (value) {
        t.lengths.push(value.trim().length);
        if (!t.samples.has(band)) t.samples.set(band, value.trim().slice(0, 160));
      }
    }

    // --- Source fields nothing consumed: the schema's blind spot ---
    for (const u of trace.unmappedSourceFields) {
      const entry = this.unmappedMap.get(u.field) ?? { records: 0, exampleValue: u.value };
      entry.records++;
      this.unmappedMap.set(u.field, entry);
    }

    // --- Deliberately excluded fields: the menu for widening the record later ---
    for (const e of trace.excludedSourceFields) {
      const entry =
        this.excludedMap.get(e.field) ?? { reason: e.reason, records: 0, exampleValue: e.value };
      entry.records++;
      this.excludedMap.set(e.field, entry);
    }

    // --- Contributing data resources: a fragmentation measurement in its own right ---
    const name = record.provenance.dataResourceName ?? "(unattributed)";
    const key = record.provenance.dataResourceUid ?? name;
    const resource =
      this.resourceMap.get(key) ??
      { uid: record.provenance.dataResourceUid, name, records: 0, substantive: 0, uncertainties: [] };
    resource.records++;
    if (bandText(record.occurrenceRemarks) === "substantive") resource.substantive++;
    if (record.coordinateUncertaintyInMeters !== null) {
      resource.uncertainties.push(record.coordinateUncertaintyInMeters);
    }
    this.resourceMap.set(key, resource);

    // --- Validation issues ---
    for (const issue of trace.validationIssues) {
      const entry =
        this.validationMap.get(issue.code) ??
        { code: issue.code, severity: issue.severity, count: 0, message: issue.message };
      entry.count++;
      this.validationMap.set(issue.code, entry);
    }

    // --- Source-supplied assertions: the source's own view of its data quality ---
    for (const a of record.sourceAssertions) {
      this.assertionMap.set(a, (this.assertionMap.get(a) ?? 0) + 1);
    }
  }

  finish(harvestKey: string, runId: string): CorpusAnalysis {
    const total = this.total;
    const safeShare = (n: number) => (total === 0 ? 0 : n / total);

    const fields = [...this.fieldMap.values()]
      .map((f) => ({ ...f, coverage: f.total === 0 ? 0 : f.populated / f.total }))
      .sort((a, b) => b.coverage - a.coverage || a.canonicalField.localeCompare(b.canonicalField));

    const freeText: FreeTextCoverage[] = FREE_TEXT_FIELDS.map((field) => {
      const t = this.text.get(field)!;
      return {
        canonicalField: field,
        total,
        bands: t.bands,
        substantiveShare: safeShare(t.bands.substantive),
        medianLength: median(t.lengths),
        maxLength: t.lengths.length > 0 ? Math.max(...t.lengths) : 0,
        samples: (["trivial", "short", "substantive"] as TextBand[])
          .filter((b) => t.samples.has(b))
          .map((b) => ({ band: b, value: t.samples.get(b)! })),
      };
    });

    const unmappedSourceFields = [...this.unmappedMap.entries()]
      .map(([field, v]) => ({ field, records: v.records, share: safeShare(v.records), exampleValue: v.exampleValue }))
      .sort((a, b) => b.records - a.records);

    const excludedSourceFields: ExcludedFieldSummary[] = [...this.excludedMap.entries()]
      .map(([field, v]) => ({
        field,
        reason: v.reason,
        records: v.records,
        share: safeShare(v.records),
        exampleValue: v.exampleValue,
      }))
      .sort((a, b) => b.records - a.records);

    const resources: ResourceBreakdown[] = [...this.resourceMap.values()]
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

    const validation = [...this.validationMap.values()].sort((a, b) => b.count - a.count);

    const sourceAssertions = [...this.assertionMap.entries()]
      .map(([assertion, count]) => ({ assertion, count, share: safeShare(count) }))
      .sort((a, b) => b.count - a.count);

    return {
      harvestKey,
      runId,
      totalRecords: total,
      validRecords: this.valid,
      fields,
      freeText,
      unmappedSourceFields,
      excludedSourceFields,
      resources,
      validation,
      sourceAssertions,
    };
  }
}

/** Whole-corpus convenience over the accumulator, for callers that already hold every record. */
export function analyseCorpus(
  harvestKey: string,
  runId: string,
  records: AdaptedRecord[],
): CorpusAnalysis {
  const analyser = new CorpusAnalyser();
  for (const r of records) analyser.add(r);
  return analyser.finish(harvestKey, runId);
}
