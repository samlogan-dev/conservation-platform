/**
 * ALA endpoint constants and the version-controlled field list.
 *
 * Everything here was verified against the live API on 29 Aug 2026: occurrence *reads* need
 * no key on any of the three live hosts. That may change; it is
 * recorded here with its date so the claim is falsifiable rather than assumed.
 */

/**
 * `biocache-ws` is the service host. `api.ala.org.au/occurrences` proxies to the same service
 * and returned byte-identical responses in testing; it is noted as the fallback because it is
 * the host ALA is migrating towards.
 */
export const ALA_BASE_URL =
  process.env.ALA_BASE_URL ?? "https://biocache-ws.ala.org.au/ws";
export const ALA_FALLBACK_BASE_URL = "https://api.ala.org.au/occurrences";

/**
 * Hard limits, measured rather than documented — see the notes in `harvest.ts`.
 *  - pageSize 100 succeeds; 200 and above return HTTP 503.
 *  - startIndex + pageSize must stay at or below 5000, and exceeding it does NOT error:
 *    the API returns HTTP 200 with an empty page.
 */
export const ALA_MAX_PAGE_SIZE = 100;
export const ALA_MAX_REACHABLE_OFFSET = 5000;

/**
 * The fields requested on every occurrence query.
 *
 * Requesting explicitly rather than taking the default view makes the field list part of the
 * run manifest: "these are the fields we asked for" is half of what the coverage table means.
 *
 * Two ALA quirks are encoded by this list rather than worked around later:
 *  1. The record id must be requested as `id`; it is *returned* as `uuid`. Requesting `uuid`
 *     silently returns nothing at all.
 *  2. Free text is asymmetric — `occurrenceRemarks` is the queryable (indexed) name, but the
 *     value is only ever returned as `raw_occurrenceRemarks`. Both are listed deliberately.
 */
export const ALA_REQUESTED_FIELDS = [
  // Identity and provenance
  "id",
  "occurrenceID",
  "dataResourceUid",
  "dataResourceName",
  "dataProviderUid",
  "dataProviderName",
  "institutionCode",
  "collectionCode",
  "catalogNumber",
  "license",
  "rights",
  // Taxon
  "scientificName",
  "raw_scientificName",
  "vernacularName",
  "taxonConceptID",
  "taxonRank",
  "kingdom",
  "phylum",
  "classs", // ALA's own spelling; `class` is reserved in its schema
  "order",
  "family",
  "genus",
  "species",
  // Event
  "eventDate",
  "year",
  "month",
  "basisOfRecord",
  "raw_basisOfRecord",
  "individualCount",
  "sex",
  "lifeStage",
  "recordedBy",
  "recordNumber",
  // Location
  "decimalLatitude",
  "decimalLongitude",
  "coordinateUncertaintyInMeters",
  "coordinatePrecision",
  "stateProvince",
  "country",
  "locality",
  "raw_locality",
  // Free text
  "occurrenceRemarks",
  "raw_occurrenceRemarks",
  "eventRemarks",
  "habitat",
  "identificationRemarks",
  "dataGeneralizations",
  "informationWithheld",
  // Source-supplied quality signals
  "assertions",
  "spatiallyValid",
  "sensitive",
  "stateConservation",
] as const;

/**
 * Free-text fields whose corpus-wide coverage is probed with exists-queries.
 *
 * Note `raw_occurrenceRemarks` is absent: it is returned on records but is not indexed, so
 * `fq=raw_occurrenceRemarks:*` matches zero records and would report 0% for a field that is
 * in fact populated. Probing the indexed name is the only measurement that means anything.
 */
export const ALA_FREE_TEXT_FIELDS = [
  "occurrenceRemarks",
  "eventRemarks",
  "habitat",
  "identificationRemarks",
] as const;

/** Additional fields worth a corpus-wide coverage probe alongside the free text. */
export const ALA_COVERAGE_PROBE_FIELDS = [
  ...ALA_FREE_TEXT_FIELDS,
  "individualCount",
  "sex",
  "lifeStage",
  "coordinateUncertaintyInMeters",
  "recordedBy",
  "images",
] as const;
