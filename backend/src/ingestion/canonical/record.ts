/**
 * The canonical internal record — the shape every adapted occurrence is stored in, and the
 * thing both analysis arms read.
 *
 * Vocabulary: Darwin Core term names, which ALA already speaks.
 *
 * **Deliberately narrow.** A field is kept when an insight could be built on it. The set was
 * first cut against a single-species, single-state harvest; as of 3 Oct 2026 the taxonomy
 * chain and state are back in, because across many species and all of Australia they stop
 * being constant and become the axes the analysis groups by. Which further fields earn a place
 * is decided by the practitioner insights, which are not yet settled.
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
  /** Basic type/required-field failures. */
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
   * The publisher's identifier for the observation (dwc:occurrenceID) — the key that joins an
   * ALA record back to the same observation at the dataset that contributed it.
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
}

export interface CanonicalRecord {
  /** Stable internal key: `${source}:${sourceRecordId}`. Deterministic, so re-runs collide. */
  recordId: string;
  provenance: Provenance;

  // --- What ---
  scientificName: string | null;
  vernacularName: string | null;
  /** ALA's taxon concept identifier — a stable key for the species across name changes. */
  taxonConceptId: string | null;
  taxonRank: string | null;
  kingdom: string | null;
  phylum: string | null;
  /** Darwin Core `class`; ALA calls it `classs`. */
  taxonClass: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;

  // --- When ---
  /** ISO 8601 UTC. ALA returns epoch millis; the conversion is recorded as `derived`. */
  eventDate: string | null;

  // --- Where ---
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  /**
   * The sharpest data-quality signal in the corpus: it separates a GPS fix from a location a
   * contributor has deliberately obscured, which threatened species often are.
   */
  coordinateUncertaintyInMeters: number | null;
  /** Australian state or territory. */
  stateProvince: string | null;
  locality: string | null;

  // --- What was seen ---
  /** Separates a live observation from a museum specimen. */
  basisOfRecord: string | null;
  individualCount: number | null;
  /**
   * Ethics pillar 2 — an irreversible pseudonym, never the observer's identity. Kept because
   * observer effort is the largest named threat to any density claim this project makes, and
   * this is the field any effort correction has to be built on.
   */
  recordedByPseudonym: string | null;

  // --- Free text ---
  occurrenceRemarks: string | null;
  eventRemarks: string | null;

  /** The source's own data-quality assertions, kept verbatim and never reinterpreted here. */
  sourceAssertions: string[];

  /** Did the record pass basic checks. */
  isValid: boolean;
}

/** A canonical record together with the audit of how it was produced. */
export interface AdaptedRecord {
  record: CanonicalRecord;
  trace: MappingTrace;
}

/**
 * What the store keeps per record: the record and the two counts the list view needs.
 *
 * The full trace is not stored. At ~10 KB per record it was the bulk of the canonical file,
 * and a large harvest would have produced a JSON document too large for Node to parse.
 * Adapting is deterministic and the raw page is frozen, so the trace for any one record is
 * regenerated on demand by re-adapting the page it came from — which is exactly what the
 * record inspector does.
 */
export interface StoredRecord {
  record: CanonicalRecord;
  /** Semantic validation issues on this record; the trace carries the detail. */
  issueCount: number;
  /** Source fields nothing accounted for; the trace carries which. */
  unmappedCount: number;
}
