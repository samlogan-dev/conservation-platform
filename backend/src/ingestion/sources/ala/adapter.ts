import type { AdaptedRecord, CanonicalRecord, Provenance } from "../../canonical/record.ts";
import { Mapper, asInteger, asNumber, asString, isEmpty } from "../../canonical/mapper.ts";
import { validateRecord } from "../../canonical/validate.ts";
import { pseudonymiseContributor } from "../../privacy/contributors.ts";
import type { AdaptContext } from "../types.ts";

/**
 * The ALA adapter: bespoke to ALA's schema, paging and quirks, emitting the shared canonical
 * record. Tailor the adapter, not the record.
 *
 * The quirks below were found against the live API rather than read out of documentation, and
 * each would have produced a silently wrong result if guessed:
 *
 *  - The record id is requested as `id` but arrives as `uuid`.
 *  - `eventDate` arrives as epoch milliseconds, not the ISO string Darwin Core specifies.
 *  - `classs` (three s's) is ALA's name for `class`.
 *  - `month` arrives as a zero-padded string, `year` as a number.
 *  - `recordedBy` is an array even when it holds one value.
 *  - Fields requested via `fl` that are not part of ALA's default view come back nested inside
 *    `otherProperties` rather than at the top level, so they must be flattened before mapping.
 *  - Free text is asymmetric: `occurrenceRemarks` is the indexed name used for querying, but
 *    the value is only ever returned as `raw_occurrenceRemarks`.
 *  - Unpopulated fields are omitted entirely rather than returned null, which is why the
 *    mapper separates `absent_from_source` from `empty_in_source`.
 */

/**
 * Lift `otherProperties` to the top level so mapping sees one flat record.
 *
 * A key already present at the top level wins, and the nested one is preserved under a
 * prefixed name rather than dropped, so a genuine collision stays visible in the trace
 * instead of being resolved silently.
 */
function flattenOtherProperties(raw: Record<string, unknown>): {
  flat: Record<string, unknown>;
  lifted: string[];
} {
  const { otherProperties, ...top } = raw;
  if (!otherProperties || typeof otherProperties !== "object") {
    return { flat: top, lifted: [] };
  }
  const flat: Record<string, unknown> = { ...top };
  const lifted: string[] = [];
  for (const [key, value] of Object.entries(otherProperties as Record<string, unknown>)) {
    if (key in flat && !isEmpty(flat[key])) {
      flat[`otherProperties.${key}`] = value;
    } else {
      flat[key] = value;
      lifted.push(key);
    }
  }
  return { flat, lifted };
}

/** ALA epoch-millis to an ISO 8601 UTC instant. */
function epochMillisToIso(value: unknown): string | null {
  const n = asNumber(value);
  if (n === null) {
    // Some contributing resources supply an ISO string instead of millis; accept both.
    const s = asString(value);
    if (s === null) return null;
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const date = new Date(n);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Register the fields ALA supplies that the canonical record deliberately does not keep.
 *
 * The measured figures below come from the koala/NSW corpus the record was first cut against
 * (Aug–Sep 2026) and should be re-checked against a many-species harvest; some will stop
 * holding once the corpus widens.
 */
function declareExclusions(m: Mapper): void {
  m.exclude(
    "duplicates scientificName / genus at the resolution kept",
    "species", "raw_scientificName",
  );
  m.exclude("constant — ALA is an Australian atlas", "country", "raw_countryCode");
  m.exclude("derivable from eventDate", "year", "month");
  m.exclude(
    "populated on 84.5% (koala/NSW) but the value is a 1e-9 placeholder, not a measurement",
    "coordinatePrecision",
  );
  m.exclude("true on 100% of koala/NSW records — no discriminating power seen yet", "spatiallyValid");
  m.exclude(
    "a state listing; how conservation status is sourced is not yet decided",
    "stateConservation",
  );
  m.exclude(
    "publisher-internal identifiers; the source record id and occurrence id already attribute the record",
    "institutionCode", "raw_institutionCode",
    "collectionCode", "raw_collectionCode", "catalogNumber", "raw_catalogNumber", "recordNumber",
  );
  m.exclude(
    "coarser duplicate of dataResource / license",
    "dataProviderUid", "dataProviderName", "rights",
  );
  m.exclude("populated on 25.7% and 2.4% respectively (koala/NSW)", "sex", "lifeStage");
  m.exclude(
    "substantive on 2.5% and 0.03% respectively (koala/NSW) — too sparse to build on yet",
    "habitat", "identificationRemarks",
  );
  m.exclude("absent from every koala/NSW record", "dataGeneralizations", "informationWithheld", "sensitive");
  m.exclude("ALA's own duplicate of basisOfRecord", "raw_basisOfRecord");
  m.exclude("free-text locality already kept as `locality`", "raw_locality");
  m.exclude("ALA's own duplicate of vernacularName", "raw_vernacularName");
}

export function adaptAlaRecord(
  rawRecord: Record<string, unknown>,
  context: AdaptContext,
): AdaptedRecord {
  const { flat, lifted } = flattenOtherProperties(rawRecord);
  const m = new Mapper(flat);

  // Internal plumbing: ALA's own indexing artefacts and duplicate observer columns. Not shown
  // in the inspector because they carry nothing a reader could act on.
  m.ignore(
    "collectors", "collector", "namesLsid", "left", "right", "taxonRankID",
    "speciesGuid", "genusGuid", "speciesGroups", "geospatialKosher", "latLong",
    "point1", "point01", "point001", "point0001", "point00001",
  );

  declareExclusions(m);

  const sourceRecordId = m.map("provenance.sourceRecordId", ["uuid"], asString) ?? "";

  const provenance: Provenance = {
    source: "ala",
    sourceRecordId,
    occurrenceId: m.map("provenance.occurrenceId", ["occurrenceID"], asString),
    harvestId: context.harvestId,
    snapshotPage: context.snapshotPage,
    fetchedAt: context.fetchedAt,
    dataResourceUid: m.map("provenance.dataResourceUid", ["dataResourceUid"], asString),
    dataResourceName: m.map("provenance.dataResourceName", ["dataResourceName"], asString),
    license: m.map("provenance.license", ["license"], asString),
  };

  const record: CanonicalRecord = {
    recordId: `ala:${sourceRecordId}`,
    provenance,

    scientificName: m.map("scientificName", ["scientificName"], asString),
    vernacularName: m.map("vernacularName", ["vernacularName"], asString),
    taxonConceptId: m.map("taxonConceptId", ["taxonConceptID"], asString),
    taxonRank: m.map("taxonRank", ["taxonRank"], asString),
    kingdom: m.map("kingdom", ["kingdom"], asString),
    phylum: m.map("phylum", ["phylum"], asString),
    taxonClass: m.map("taxonClass", ["classs"], asString, { note: "ALA spells Darwin Core `class` as `classs`" }),
    order: m.map("order", ["order"], asString),
    family: m.map("family", ["family"], asString),
    genus: m.map("genus", ["genus"], asString),

    eventDate: m.map("eventDate", ["eventDate"], epochMillisToIso, {
      note: "ALA returns epoch milliseconds; converted to ISO 8601 UTC",
    }),

    decimalLatitude: m.map("decimalLatitude", ["decimalLatitude"], asNumber),
    decimalLongitude: m.map("decimalLongitude", ["decimalLongitude"], asNumber),
    coordinateUncertaintyInMeters: m.map(
      "coordinateUncertaintyInMeters",
      ["coordinateUncertaintyInMeters"],
      asNumber,
    ),
    stateProvince: m.map("stateProvince", ["stateProvince"], asString),
    locality: m.map("locality", ["locality"], asString),

    basisOfRecord: m.map("basisOfRecord", ["basisOfRecord"], asString),
    individualCount: m.map("individualCount", ["individualCount"], asInteger),
    recordedByPseudonym: m.map("recordedByPseudonym", ["recordedBy"], pseudonymiseContributor, {
      note: "ethics pillar 2 — observer identifier replaced with a stable pseudonym; the raw value stays in the snapshot only",
    }),

    // `raw_occurrenceRemarks` is listed first because it is the name the value actually
    // arrives under.
    occurrenceRemarks: m.map(
      "occurrenceRemarks",
      ["raw_occurrenceRemarks", "occurrenceRemarks"],
      asString,
      { note: "queryable as `occurrenceRemarks`, returned as `raw_occurrenceRemarks`" },
    ),
    eventRemarks: m.map("eventRemarks", ["eventRemarks"], asString),

    sourceAssertions:
      m.map<string[]>("sourceAssertions", ["assertions"], (value) =>
        Array.isArray(value) ? value.map(String) : null,
      ) ?? [],

    isValid: true,
  };

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
      liftedFromOtherProperties: lifted,
    },
  };
}

/** Adapt every occurrence in one frozen page body. */
export function adaptAlaPage(pageBody: string, context: AdaptContext): AdaptedRecord[] {
  const parsed = JSON.parse(pageBody) as { occurrences?: Record<string, unknown>[] };
  return (parsed.occurrences ?? []).map((raw) => adaptAlaRecord(raw, context));
}

export { flattenOtherProperties };
