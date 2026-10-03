import type { CanonicalRecord } from "./record.ts";

/**
 * The canonical schema, declared as data rather than left implicit in the TypeScript types.
 *
 * Stage 1's stated output is the schema, not the records — so it should be a thing the
 * platform can show, check against and version, not something a reader has to reconstruct by
 * reading interfaces. The types still enforce it at compile time; this describes it at runtime.
 */

export type FieldType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "iso8601"
  | "latitude"
  | "longitude"
  | "string[]";

export interface SchemaField {
  /** Dotted path into the canonical record. */
  path: string;
  type: FieldType;
  /** A record missing a required field is not usable and fails the structural check. */
  required: boolean;
  description: string;
  /** Source field(s) the ALA adapter consults. Shown so the schema explains its own origins. */
  sourceFields?: string[];
}

export interface SchemaGroup {
  key: string;
  label: string;
  description: string;
  fields: SchemaField[];
}

export const CANONICAL_SCHEMA: SchemaGroup[] = [
  {
    key: "identity",
    label: "Identity",
    description: "The key this record is stored and de-duplicated under.",
    fields: [
      {
        path: "recordId",
        type: "string",
        required: true,
        description: "Internal key, `source:sourceRecordId`. Deterministic, so re-runs collide rather than duplicate.",
      },
    ],
  },
  {
    key: "provenance",
    label: "Provenance",
    description:
      "Where the record came from and under what licence. Ethics pillar 3 — attribution is never optional, so every field here is required except the dataset labels the source may omit.",
    fields: [
      { path: "provenance.source", type: "string", required: true, description: "Registry key of the source system." },
      { path: "provenance.sourceRecordId", type: "string", required: true, description: "The source's own identifier for this record.", sourceFields: ["uuid"] },
      { path: "provenance.occurrenceId", type: "string", required: false, description: "The publisher's identifier for the observation. The key that joins the same observation across sources.", sourceFields: ["occurrenceID"] },
      { path: "provenance.harvestId", type: "string", required: true, description: "Which harvest run produced it — joins back to the frozen snapshot." },
      { path: "provenance.snapshotPage", type: "string", required: true, description: "The frozen page the record was parsed from." },
      { path: "provenance.fetchedAt", type: "iso8601", required: true, description: "When the source was called." },
      { path: "provenance.dataResourceUid", type: "string", required: false, description: "The contributing dataset inside the source.", sourceFields: ["dataResourceUid"] },
      { path: "provenance.dataResourceName", type: "string", required: false, description: "Human-readable name of that dataset.", sourceFields: ["dataResourceName"] },
      { path: "provenance.license", type: "string", required: false, description: "Licence the record is published under.", sourceFields: ["license"] },
      { path: "provenance.contentRedistributable", type: "boolean", required: true, description: "Whether the contributor's text may be republished, as opposed to only analysed. False withholds the text at the API boundary.", sourceFields: ["license_code"] },
    ],
  },
  {
    key: "taxon",
    label: "What was seen",
    description: "The species. Narrow by design — the full taxonomy chain is identical on every record in a single-species harvest.",
    fields: [
      { path: "scientificName", type: "string", required: true, description: "Binomial name.", sourceFields: ["scientificName"] },
      { path: "vernacularName", type: "string", required: false, description: "Common name.", sourceFields: ["vernacularName"] },
    ],
  },
  {
    key: "event",
    label: "When",
    description: "When the observation happened.",
    fields: [
      {
        path: "eventDate",
        type: "iso8601",
        required: false,
        description: "Observation date. ALA supplies epoch milliseconds; converted on the way in.",
        sourceFields: ["eventDate"],
      },
    ],
  },
  {
    key: "location",
    label: "Where",
    description: "Position and how well it is known. Coordinates are stored precise and reduced to ~1.1km at the API boundary.",
    fields: [
      { path: "decimalLatitude", type: "latitude", required: false, description: "Latitude, WGS84.", sourceFields: ["decimalLatitude"] },
      { path: "decimalLongitude", type: "longitude", required: false, description: "Longitude, WGS84.", sourceFields: ["decimalLongitude"] },
      {
        path: "coordinateUncertaintyInMeters",
        type: "number",
        required: false,
        description: "Radius the true position could fall within. The sharpest quality signal in the corpus — it is what distinguishes a GPS fix from a deliberately obscured location.",
        sourceFields: ["coordinateUncertaintyInMeters"],
      },
      { path: "locality", type: "string", required: false, description: "Free-text place description.", sourceFields: ["locality"] },
    ],
  },
  {
    key: "observation",
    label: "The observation",
    description: "What kind of record it is and what was counted.",
    fields: [
      { path: "basisOfRecord", type: "string", required: false, description: "Live observation vs preserved museum specimen.", sourceFields: ["basisOfRecord"] },
      { path: "individualCount", type: "integer", required: false, description: "Animals reported. Not a survey count.", sourceFields: ["individualCount"] },
      {
        path: "recordType",
        type: "string",
        required: true,
        description: "The channel the record entered through: government_database, public_sighting, rescue_rehab, survey_research, specimen or other. Derived from the dataset, the basis of record, rehab record numbers and encounter codes.",
        sourceFields: ["dataResourceUid", "basisOfRecord", "recordNumber", "raw_occurrenceRemarks"],
      },
      {
        path: "recordedByPseudonym",
        type: "string",
        required: false,
        description: "Ethics pillar 2 — an irreversible pseudonym for the observer. The raw identifier exists only in the frozen snapshot. Retained because observer effort is the largest confound on any density claim.",
        sourceFields: ["recordedBy"],
      },
    ],
  },
  {
    key: "freeText",
    label: "Free text",
    description: "The unstructured material the LLM arm depends on existing at all.",
    fields: [
      {
        path: "occurrenceRemarks",
        type: "string",
        required: false,
        description: "The observer's notes. Queryable as `occurrenceRemarks`, returned as `raw_occurrenceRemarks`.",
        sourceFields: ["raw_occurrenceRemarks", "occurrenceRemarks"],
      },
      { path: "eventRemarks", type: "string", required: false, description: "Notes about the survey event.", sourceFields: ["eventRemarks"] },
    ],
  },
  {
    key: "quality",
    label: "Quality",
    description: "Signals about the record's reliability, kept verbatim and never reinterpreted here.",
    fields: [
      {
        path: "sourceAssertions",
        type: "string[]",
        required: true,
        description: "The source's own data-quality flags. The baseline a governance layer would be measured against.",
        sourceFields: ["assertions"],
      },
      { path: "sourceQualityGrade", type: "string", required: false, description: "The source's own overall verdict on the record, where it publishes one. ALA has none; iNaturalist grades research / needs_id / casual.", sourceFields: ["quality_grade"] },
      { path: "isValid", type: "boolean", required: true, description: "Passed the basic checks. Not a Layer 1 verdict." },
    ],
  },
];

/** Flat list of every field in the schema, in declaration order. */
export const SCHEMA_FIELDS: SchemaField[] = CANONICAL_SCHEMA.flatMap((g) => g.fields);

export type SchemaCheckStatus =
  /** Present and the right type. */
  | "ok"
  /** Absent, and the schema allows that. */
  | "empty"
  /** Absent, and the schema does not allow that. */
  | "missing_required"
  /** Present but not the declared type. */
  | "type_mismatch";

export interface SchemaCheck {
  path: string;
  status: SchemaCheckStatus;
  actualType: string;
  value: unknown;
}

function readPath(record: CanonicalRecord, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), record);
}

function conforms(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "iso8601":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "latitude":
      return typeof value === "number" && value >= -90 && value <= 90;
    case "longitude":
      return typeof value === "number" && value >= -180 && value <= 180;
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
}

const describeType = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "absent";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

/**
 * Structural conformance of one record to the schema. Distinct from `validateRecord`, which
 * asks semantic questions (is this date in the future, is this point inside Australia).
 */
export function checkAgainstSchema(record: CanonicalRecord): SchemaCheck[] {
  return SCHEMA_FIELDS.map((field) => {
    const value = readPath(record, field.path);
    const isEmpty = value === null || value === undefined || value === "";

    let status: SchemaCheckStatus;
    if (isEmpty) {
      status = field.required ? "missing_required" : "empty";
    } else {
      status = conforms(value, field.type) ? "ok" : "type_mismatch";
    }

    return { path: field.path, status, actualType: describeType(value), value };
  });
}
