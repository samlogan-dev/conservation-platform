import { recordTypeOf } from "../../canonical/recordType.ts";
import type { AdaptedRecord, CanonicalRecord, Provenance } from "../../canonical/record.ts";
import { Mapper, asInteger, asString } from "../../canonical/mapper.ts";
import { validateRecord } from "../../canonical/validate.ts";
import { pseudonymiseContributor } from "../../privacy/contributors.ts";
import type { AdaptContext } from "../types.ts";

/**
 * The iNaturalist adapter.
 *
 * This is the stage's actual test: a source that shares no vocabulary with the one the
 * canonical record was derived from. ALA speaks Darwin Core and mostly needed renaming;
 * iNaturalist needs genuine reshaping, and where it does is recorded field by field below.
 *
 * Differences that mattered:
 *  - Coordinates arrive as a `"lat,lng"` string, or as GeoJSON with the axes reversed.
 *  - The taxon is a nested object, not flat columns.
 *  - There is no `basisOfRecord`: every iNaturalist observation is a human observation, so the
 *    value is asserted by the adapter rather than read, and the trace says so.
 *  - Quality signals are booleans and counts (`obscured`, `captive`, identification
 *    disagreements) rather than ALA's assertion vocabulary, so they are named as they are
 *    rather than translated into ALA's terms.
 *  - Licensing is per record and genuinely restrictive — see `contentRedistributable`.
 */

/** Licences under which a contributor has permitted redistribution of their content. */
const REDISTRIBUTABLE_LICENCES = new Set([
  "cc0",
  "cc-by",
  "cc-by-nc",
  "cc-by-sa",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
]);

/** `"-34.74282,146.5248116667"` → the two numbers, or null if unusable/absent. */
function parseLocation(value: unknown): { lat: number; lon: number } | null {
  const text = asString(value);
  if (text === null) return null;
  const [lat, lon] = text.split(",").map((p) => Number(p.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: lat!, lon: lon! };
}

/**
 * iNaturalist's own quality signals, expressed in its own vocabulary.
 *
 * Deliberately not translated into ALA's assertion codes. The two sources are making different
 * claims about different things, and mapping `obscured` onto `COORDINATE_ROUNDED` would invent
 * an equivalence that does not exist. Which source an assertion came from is always knowable
 * from `provenance.source`, so the vocabularies can coexist without collision.
 */
function deriveAssertions(raw: Record<string, unknown>): string[] {
  const assertions: string[] = [];
  if (raw["obscured"] === true) assertions.push("COORDINATES_OBSCURED");
  if (raw["captive"] === true) assertions.push("CAPTIVE_OR_CULTIVATED");
  if (raw["spam"] === true) assertions.push("FLAGGED_SPAM");
  if (Number(raw["num_identification_disagreements"] ?? 0) > 0) {
    assertions.push("IDENTIFICATION_DISAGREEMENT");
  }
  if (Number(raw["identifications_count"] ?? 0) <= 1) {
    assertions.push("SINGLE_IDENTIFICATION");
  }
  if (raw["taxon_geoprivacy"] === "obscured" || raw["geoprivacy"] === "obscured") {
    assertions.push("GEOPRIVACY_OBSCURED");
  }
  return assertions;
}

export function adaptInaturalistRecord(
  rawRecord: Record<string, unknown>,
  context: AdaptContext,
): AdaptedRecord {
  const m = new Mapper(rawRecord);

  // Nested structures the adapter reads through rather than mapping directly, plus iNaturalist's
  // social and display machinery, which carries nothing a conservation record needs.
  m.ignore(
    "taxon", "user", "geojson", "photos", "observation_photos", "sounds", "identifications",
    "comments", "annotations", "votes", "faves", "flags", "quality_metrics", "ofvs",
    "project_observations", "preferences", "observed_on_details", "created_at_details",
  );

  m.exclude(
    "iNaturalist display and social metadata — no bearing on the observation",
    "cached_votes_total", "faves_count", "comments_count", "map_scale", "mappable",
    "site_id", "oauth_application_id", "reviewed_by", "non_owner_ids", "outlinks",
    "owners_identification_from_vision", "spam", "tags", "uri",
  );
  m.exclude(
    "iNaturalist internal identifiers and indexes",
    "uuid", "community_taxon_id", "ident_taxon_ids", "place_ids", "project_ids",
    "project_ids_with_curator_id", "project_ids_without_curator_id",
  );
  m.exclude(
    "timezone and update bookkeeping, not part of the observation",
    "created_at", "updated_at", "time_zone_offset", "observed_time_zone", "created_time_zone",
    "observed_on_string",
  );
  m.exclude(
    "the observer's own free-text guess before identification — superseded by the community taxon",
    "species_guess",
  );
  m.exclude(
    "captured as derived assertions rather than as fields — see deriveAssertions",
    "identifications_most_agree", "identifications_most_disagree", "identifications_some_agree",
    "identification_disagreements_count", "num_identification_agreements",
  );

  const sourceRecordId = m.map("provenance.sourceRecordId", ["id"], asString) ?? "";

  // iNaturalist has no dwc:occurrenceID of its own, but ALA republishes these records under the
  // canonical observation URL. Constructing the same string here is what makes the two corpora
  // joinable — the whole point of taking a second source.
  const occurrenceId = sourceRecordId
    ? `https://www.inaturalist.org/observations/${sourceRecordId}`
    : null;

  const licenseCode = asString(rawRecord["license_code"]);
  m.map("provenance.license", ["license_code"], asString);

  const provenance: Provenance = {
    source: "inaturalist",
    sourceRecordId,
    occurrenceId,
    harvestId: context.harvestId,
    snapshotPage: context.snapshotPage,
    fetchedAt: context.fetchedAt,
    // iNaturalist is a single dataset rather than an aggregator of many, so the resource is the
    // platform itself. Kept populated so the contributing-resource view works across sources.
    dataResourceUid: "inaturalist",
    dataResourceName: "iNaturalist",
    license: licenseCode,
    // The absence of a licence means All Rights Reserved, not permission.
    contentRedistributable: licenseCode !== null && REDISTRIBUTABLE_LICENCES.has(licenseCode),
  };

  const taxon = (rawRecord["taxon"] ?? {}) as Record<string, unknown>;
  const user = (rawRecord["user"] ?? {}) as Record<string, unknown>;
  const location = parseLocation(rawRecord["location"]);

  const record: CanonicalRecord = {
    recordId: `inaturalist:${sourceRecordId}`,
    provenance,

    scientificName: asString(taxon["name"]),
    vernacularName: asString(taxon["preferred_common_name"]),

    // `time_observed_at` carries a timezone offset; `observed_on` is date-only. Prefer the
    // precise one and fall back, rather than silently losing the time of day.
    eventDate: m.map(
      "eventDate",
      ["time_observed_at", "observed_on"],
      (value) => {
        const text = asString(value);
        if (text === null) return null;
        const parsed = Date.parse(text);
        return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
      },
      { note: "ISO with UTC offset; normalised to UTC" },
    ),

    decimalLatitude: m.map("decimalLatitude", ["location"], () => location?.lat ?? null, {
      note: 'iNaturalist returns a single "lat,lng" string; split on the way in',
    }),
    decimalLongitude: m.map("decimalLongitude", ["location"], () => location?.lon ?? null, {
      note: 'iNaturalist returns a single "lat,lng" string; split on the way in',
    }),
    // `public_positional_accuracy` is the honest figure: for an obscured record it reflects the
    // obscuring radius rather than the observer's GPS, which is exactly what a consumer sees.
    coordinateUncertaintyInMeters: m.map(
      "coordinateUncertaintyInMeters",
      ["public_positional_accuracy", "positional_accuracy"],
      asInteger,
      { note: "public accuracy preferred — it reflects obscuring, not the observer's GPS" },
    ),
    locality: m.map("locality", ["place_guess"], asString),

    // Every iNaturalist observation is a human observation; there is no field to read.
    basisOfRecord: "HUMAN_OBSERVATION",
    // iNaturalist has no count field — abundance lives in optional observation fields, which
    // are not populated consistently enough to map.
    individualCount: null,
    // A public sighting unless the observer's own text says the animal came into care.
    recordType: recordTypeOf({
      dataResourceUid: "inaturalist",
      basisOfRecord: "HUMAN_OBSERVATION",
      recordNumber: null,
      remarks: asString(rawRecord["description"]),
    }),
    recordedByPseudonym: pseudonymiseContributor(user["login"] ?? user["id"] ?? null),

    occurrenceRemarks: m.map("occurrenceRemarks", ["description"], asString),
    // iNaturalist has no separate event-level remarks.
    eventRemarks: null,

    sourceAssertions: deriveAssertions(rawRecord),
    sourceQualityGrade: m.map("sourceQualityGrade", ["quality_grade"], asString),

    isValid: true,
  };

  // Fields asserted or read through nested objects still need accounting for, so the unmapped
  // list stays a genuine warning rather than filling with things the adapter handled elsewhere.
  m.ignore("location", "positional_accuracy", "public_positional_accuracy", "description",
    "place_guess", "quality_grade", "id", "license_code", "observed_on", "time_observed_at",
    "obscured", "captive", "geoprivacy", "taxon_geoprivacy", "identifications_count",
    "num_identification_disagreements");

  const validationIssues = validateRecord(record);
  record.isValid = !validationIssues.some((i) => i.severity === "error");

  return {
    record,
    trace: {
      sourceRecordId,
      fields: m.getTraces(),
      excludedSourceFields: m.getExcluded(),
      unmappedSourceFields: m.getUnmapped(),
      validationIssues,
      // iNaturalist has no equivalent of ALA's otherProperties nesting.
      liftedFromOtherProperties: [],
    },
  };
}

export function adaptInaturalistPage(pageBody: string, context: AdaptContext): AdaptedRecord[] {
  const parsed = JSON.parse(pageBody) as { results?: Record<string, unknown>[] };
  return (parsed.results ?? []).map((raw) => adaptInaturalistRecord(raw, context));
}
