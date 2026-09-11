/**
 * Shapes returned by the corpus API. Mirrors the backend's canonical record and analysis
 * types; kept as a hand-written mirror rather than a shared package because the canonical
 * shape is still changing every few minutes and a build-time coupling would slow that down.
 */

export type FieldStatus =
  | "mapped"
  | "derived"
  | "empty_in_source"
  | "absent_from_source"
  | "rejected";

export interface FieldTrace {
  canonicalField: string;
  sourceFields: string[];
  /** Absent from the payload entirely when the source omitted the field. */
  rawValue?: unknown;
  canonicalValue: unknown;
  status: FieldStatus;
  note?: string;
  redactionReason?: string;
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface MappingTrace {
  sourceRecordId: string;
  fields: FieldTrace[];
  /** Source fields deliberately not kept, with the reason — the menu for widening the record. */
  excludedSourceFields: { field: string; reason: string; value: unknown }[];
  /** Source fields nothing accounted for. Unlike the above, a warning. */
  unmappedSourceFields: { field: string; value: unknown }[];
  validationIssues: ValidationIssue[];
  liftedFromOtherProperties: string[];
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  expectedRecords: number;
  retrievedRecords: number;
  complete: boolean;
  corpusHash: string;
  warnings: number;
}

export interface Harvest {
  key: string;
  description: string;
  source: string;
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  runs: RunSummary[];
}

export interface Manifest {
  runId: string;
  harvestKey: string;
  description: string;
  source: string;
  baseUrl: string;
  query: { q: string; fq: string[] };
  requestedFields: string[];
  politeness: { userAgent: string; minRequestIntervalMs: number };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  expectedRecords: number;
  retrievedRecords: number;
  complete: boolean;
  slices: {
    sliceKey: string;
    filters: string[];
    expectedRecords: number;
    retrievedRecords: number;
    pages: number;
  }[];
  pages: { file: string; sliceKey: string; recordCount: number; contentHash: string; bytes: number }[];
  corpusHash: string;
  requestCount: number;
  warnings: string[];
}

export type TextBand = "absent" | "trivial" | "short" | "substantive";

export interface Analysis {
  harvestKey: string;
  runId: string;
  totalRecords: number;
  validRecords: number;
  fields: {
    canonicalField: string;
    sourceFields: string[];
    counts: Record<FieldStatus, number>;
    populated: number;
    total: number;
    coverage: number;
  }[];
  freeText: {
    canonicalField: string;
    total: number;
    bands: Record<TextBand, number>;
    substantiveShare: number;
    medianLength: number;
    maxLength: number;
    samples: { band: TextBand; value: string }[];
  }[];
  unmappedSourceFields: { field: string; records: number; share: number; exampleValue: unknown }[];
  excludedSourceFields: {
    field: string;
    reason: string;
    records: number;
    share: number;
    exampleValue: unknown;
  }[];
  resources: {
    dataResourceUid: string | null;
    dataResourceName: string;
    records: number;
    share: number;
    substantiveRemarks: number;
    meanCoordinateUncertainty: number | null;
    medianCoordinateUncertainty: number | null;
    obscuredRecords: number;
  }[];
  validation: { code: string; severity: string; count: number; message: string }[];
  sourceAssertions: { assertion: string; count: number; share: number }[];
}

export interface SourceSide {
  source: string;
  harvestKey: string;
  runId: string;
  /** Records in the whole corpus, before it was restricted to the shared namespace. */
  corpusRecords: number;
  /** Records inside the shared namespace — the only ones the join can see. */
  totalRecords: number;
  joinable: number;
  substantiveText: number;
}

export interface SourceComparison {
  namespace: string;
  left: SourceSide;
  right: SourceSide;
  matched: number;
  onlyLeft: number;
  onlyRight: number;
  coverageOfLeft: number;
  matchedTextLeft: number;
  matchedTextRight: number;
  /** Matched records obscured beyond 10 km, per side — whether the privacy signal survives transit. */
  matchedObscuredLeft: number;
  matchedObscuredRight: number;
  onlyLeftByLicence: {
    license: string;
    records: number;
    share: number;
    redistributable: boolean;
  }[];
  unexplainedShortfall: number;
}

// ---- Threat and condition extraction from free text

export type TextSubject = "koala" | "not_koala" | "unclear";
export type TextCondition = "alive_healthy" | "alive_unwell" | "dead" | "unknown";
export type TextEvent =
  | "vehicle_strike"
  | "dog_attack"
  | "disease"
  | "injury"
  | "fire"
  | "rescue_or_care"
  | "with_joey";
export type ClassifierKey = "keyword" | "llm";

/** What one classifier's pass over one run says, as counts. */
export interface TextSummary {
  classifier: ClassifierKey;
  model: string | null;
  promptVersion: string | null;
  taxonomyVersion: string;
  finishedAt: string;
  uniqueTexts: number;
  labelledTexts: number;
  recordsCovered: number;
  koalaRecords: number;
  usage: { requests: number; inputTokens: number; outputTokens: number };
  bySubject: Record<TextSubject, number>;
  byCondition: Record<TextCondition, number>;
  byEvent: Record<TextEvent, number>;
  byDataset: {
    dataResourceUid: string | null;
    dataResourceName: string;
    records: number;
    dead: number;
    unwell: number;
    events: Record<TextEvent, number>;
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
  agreement: { with: ClassifierKey; texts: number; subject: number; condition: number; events: number } | null;
}

export interface TextOverview {
  taxonomy: {
    version: string;
    subjects: Record<TextSubject, string>;
    conditions: Record<TextCondition, string>;
    events: Record<TextEvent, string>;
  };
  summaries: TextSummary[];
}

/** One labelled remark, joined to the record it describes. */
export interface TextRow {
  recordId: string;
  field: "occurrenceRemarks" | "eventRemarks";
  source: string;
  dataResourceName: string | null;
  eventDate: string | null;
  subject: TextSubject;
  condition: TextCondition;
  events: TextEvent[];
  confidence: number;
  evidence: string | null;
  textWithheld: boolean;
  textHash: string;
  classifier: ClassifierKey;
  model: string | null;
  promptVersion: string | null;
}

export interface TextRows {
  classifier: ClassifierKey;
  available: ClassifierKey[];
  total: number;
  offset: number;
  limit: number;
  items: TextRow[];
}

/** One source's newest run for a species, region and window. */
export interface FamilyMember {
  harvestKey: string;
  runId: string;
  source: string;
  manifest: Manifest;
  analysis: Analysis;
  /** One summary per classifier that has labelled this run's text. */
  text: TextSummary[];
}

/** Every source fetched for the same species, region and window, plus the pairwise joins. */
export interface CorpusFamily {
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  members: FamilyMember[];
  comparisons: SourceComparison[];
}

/**
 * One row of the sightings table: the whole public record (coordinates fuzzed, withheld text
 * nulled) plus what the grid needs to colour it. Nested `provenance` is kept as the backend
 * stores it; the grid reads columns by dotted path.
 */
export interface RecordRow {
  recordId: string;
  provenance: {
    source: string;
    sourceRecordId: string;
    occurrenceId: string | null;
    harvestId: string;
    snapshotPage: string;
    fetchedAt: string;
    dataResourceUid: string | null;
    dataResourceName: string | null;
    license: string | null;
    contentRedistributable: boolean;
  };
  scientificName: string | null;
  vernacularName: string | null;
  eventDate: string | null;
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  coordinateUncertaintyInMeters: number | null;
  locality: string | null;
  basisOfRecord: string | null;
  individualCount: number | null;
  recordedByPseudonym: string | null;
  occurrenceRemarks: string | null;
  eventRemarks: string | null;
  sourceAssertions: string[];
  sourceQualityGrade: string | null;
  isValid: boolean;
  coordinatesFuzzed: boolean;
  fuzzedToApproxMetres: number | null;
  textWithheld: boolean;
  textWithheldReason: string | null;
  issueCount: number;
  unmappedCount: number;
  /** Structural checks that are neither ok nor an allowed empty. Sparse. */
  schemaProblems: { path: string; status: "missing_required" | "type_mismatch" }[];
}

export interface RecordList {
  total: number;
  corpusTotal: number;
  offset: number;
  limit: number;
  items: RecordRow[];
}

export interface SnapshotPageMeta {
  file: string;
  sliceKey: string;
  startIndex: number;
  pageSize: number;
  recordCount: number;
  url: string;
  status: number;
  fetchedAt: string;
  durationMs: number;
  attempts: number;
  contentHash: string;
  bytes: number;
}

export interface PagesResponse {
  serveRawResponses: boolean;
  /** Top-level key of a page body holding the record array (`occurrences` for ALA, `results` for iNaturalist). */
  recordsKey: string;
  query: { q: string; fq: string[] };
  slices: {
    sliceKey: string;
    filters: string[];
    expectedRecords: number;
    retrievedRecords: number;
    pages: SnapshotPageMeta[];
  }[];
}

export interface RawPageResponse {
  page: SnapshotPageMeta;
  body: string;
}

export type SchemaCheckStatus = "ok" | "empty" | "missing_required" | "type_mismatch";

export interface SchemaFieldDef {
  path: string;
  type: string;
  required: boolean;
  description: string;
  sourceFields?: string[];
  conformance: Record<SchemaCheckStatus, number>;
}

export interface SchemaResponse {
  totalRecords: number;
  groups: {
    key: string;
    label: string;
    description: string;
    fields: SchemaFieldDef[];
  }[];
}

export interface SchemaCheck {
  path: string;
  status: SchemaCheckStatus;
  actualType: string;
  value: unknown;
  provenance: FieldTrace | null;
}

export interface RecordDetail {
  record: Record<string, unknown> & {
    textWithheld?: boolean;
    textWithheldReason?: string | null;
  };
  trace: MappingTrace;
  schemaChecks: SchemaCheck[];
  raw: Record<string, unknown>;
  redactions: { field: string; reason: string }[];
  snapshotPage: string;
}
