/**
 * The canonical internal record.
 *
 * Stage 1's actual output. Every source, however bespoke its adapter, emits this shape —
 * without it, cross-source disagreement (a Layer 2 rule) cannot be computed at all.
 *
 * Vocabulary: Darwin Core term names, chosen because ALA and GBIF both already speak it, so
 * the mapping work transfers to the next source almost free.
 *
 * **Deliberately narrow (revised 29 Aug 2026).** The first cut carried roughly forty fields,
 * which made every record unreadable without telling anyone anything: thirteen of them held a
 * single distinct value across all 2,865 records — every koala is in Animalia, every record in
 * this window is from 2025 and in New South Wales. What remains is the set an insight could
 * actually be built on.
 *
 * Widening this back out is cheap and expected. The raw response is frozen verbatim before any
 * of this is applied, so restoring a field is an edit plus `npm run ingest -- adapt` — about a
 * second, and no network traffic. Fields excluded on purpose are listed in the adapter with
 * the reason, and surface in the record inspector, so the menu of what can come back stays
 * visible rather than becoming folklore.
 */

/** Where a canonical value came from, and what happened to it on the way. */
export type FieldStatus =
  /** Source supplied a usable value and it mapped cleanly. */
  | "mapped"
  /** Source carried the field but its value was null/empty — populated with nothing. */
  | "empty_in_source"
  /** Source did not carry the field at all. Distinct from empty: ALA omits unpopulated fields. */
  | "absent_from_source"
  /** Source had a value, but it was transformed materially (units, epoch→ISO, array→scalar). */
  | "derived"
  /** Source had a value and it failed a check, so it did not reach the canonical record. */
  | "rejected";

/** One line of the mapping trace: the audit of a single canonical field. */
export interface FieldTrace {
  canonicalField: string;
  sourceFields: string[];
  rawValue: unknown;
  canonicalValue: unknown;
  status: FieldStatus;
  note?: string;
}

/**
 * The full account of one record's trip through the adapter. This is what the record
 * inspector renders: not raw-beside-mapped, but raw → mapped → what happened in between.
 */
export interface MappingTrace {
  sourceRecordId: string;
  fields: FieldTrace[];
  /**
   * Source fields the adapter knows about and has chosen not to keep, with the reason. This
   * is the menu for widening the record later — the difference between a considered omission
   * and an oversight.
   */
  excludedSourceFields: { field: string; reason: string; value: unknown }[];
  /**
   * Source fields nothing accounted for — neither mapped nor deliberately excluded. Unlike
   * the list above this is a warning: the source sent something the adapter has never been
   * told about, which usually means the source changed.
   */
  unmappedSourceFields: { field: string; value: unknown }[];
  /** Basic type/required-field failures. Not Layer 1 — see Build Scope. */
  validationIssues: ValidationIssue[];
  /** Fields ALA nested inside `otherProperties` and the adapter had to lift out. */
  liftedFromOtherProperties: string[];
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

/** Provenance carried on every record. Ethics pillar 3 — attribution, never optional. */
export interface Provenance {
  /** Registry key of the source, e.g. "ala". */
  source: string;
  /** The source's own identifier for this record. Pillar 3 requires it on every row. */
  sourceRecordId: string;
  /**
   * The publisher's identifier for the observation (dwc:occurrenceID).
   *
   * Restored in Stage 2, having been excluded in Stage 1 with the note "needed for
   * cross-source de-duplication once a second source lands, not before". It is now before:
   * ALA republishes iNaturalist records with an occurrenceID of
   * `https://www.inaturalist.org/observations/<id>`, which is the only key that joins the two
   * corpora. The excluded-fields menu doing its job.
   */
  occurrenceId: string | null;
  /** Which harvest produced this record — joins it back to its frozen snapshot. */
  harvestId: string;
  /** Which frozen page within that snapshot the record was parsed from. */
  snapshotPage: string;
  fetchedAt: string;
  /** The dataset within the source. Drives the contributing-resource view. */
  dataResourceUid: string | null;
  dataResourceName: string | null;
  /** Required for attribution in the UI. */
  license: string | null;
  /**
   * Whether this record's free text may be republished, as opposed to merely analysed.
   *
   * Each adapter answers in its own licensing vocabulary, which is the point: aggregators only
   * ever publish what they are permitted to publish, so anything arriving via ALA is already
   * filtered. Fetching a source *directly* bypasses that filter and puts the question back on
   * this platform — Stage 2 found 63% of iNaturalist's koala observations are All Rights
   * Reserved and never reach an aggregator at all.
   *
   * False does not stop the record being counted, measured or reasoned about; it stops the
   * contributor's text being served. Enforced at the API boundary alongside coordinate
   * fuzzing, because that is the point where analysis ends and redistribution begins.
   */
  contentRedistributable: boolean;
}

export interface CanonicalRecord {
  /** Stable internal key: `${source}:${sourceRecordId}`. Deterministic, so re-runs collide. */
  recordId: string;
  provenance: Provenance;

  // --- What ---
  scientificName: string | null;
  vernacularName: string | null;

  // --- When ---
  /** ISO 8601 UTC. ALA returns epoch millis; the conversion is recorded as `derived`. */
  eventDate: string | null;

  // --- Where ---
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  /**
   * Kept because it is the sharpest data-quality signal in the corpus: it is what exposes
   * iNaturalist's ~28km obscuring of threatened-species locations as a privacy artefact
   * rather than an error.
   */
  coordinateUncertaintyInMeters: number | null;
  locality: string | null;

  // --- What was seen ---
  /** Separates a live observation from a museum specimen — 2,763 vs 102 in this corpus. */
  basisOfRecord: string | null;
  individualCount: number | null;
  /**
   * Ethics pillar 2 — an irreversible pseudonym, never the observer's identity. Kept despite
   * the trim because observer effort is the largest named threat to any density claim this
   * project makes, and this is the field any effort correction has to be built on.
   */
  recordedByPseudonym: string | null;

  // --- Free text: the material the LLM arm depends on existing at all ---
  occurrenceRemarks: string | null;
  eventRemarks: string | null;

  /**
   * The source's own data-quality assertions, kept verbatim and never reinterpreted here.
   * The baseline a governance layer would eventually be measured against — most of why ALA
   * was taken first.
   */
  sourceAssertions: string[];

  /**
   * The source's own overall verdict on the record, where it publishes one.
   *
   * Distinct from `sourceAssertions`, which are per-issue flags. ALA has no such grade and
   * leaves this null; iNaturalist publishes `research` / `needs_id` / `casual`. Added in
   * Stage 2 rather than widening `sourceAssertions`, because a single overall judgement and a
   * list of specific complaints are different kinds of claim and flattening them together
   * would lose that — and because Stage 1 found ALA's assertions a weak baseline (four fire on
   * 100% of records), which makes a real grade worth having its own field.
   */
  sourceQualityGrade: string | null;

  /** Did the record pass basic checks. Not a Layer 1 verdict. */
  isValid: boolean;
}

/** A canonical record together with the audit of how it was produced. */
export interface AdaptedRecord {
  record: CanonicalRecord;
  trace: MappingTrace;
}
