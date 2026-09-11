import type { CanonicalRecord, ValidationIssue } from "./record.ts";

/**
 * Basic type and required-field checking, which happens naturally as part of adapting.
 *
 * This is deliberately NOT Layer 1 (schema conformance) and must not be mistaken for it —
 * Stage 1 excludes the evaluation layers on purpose. There is no rule registry here, no
 * severity policy, no trigger-rate reporting. It exists so the adapter can say which records
 * came out unusable and why, which the record inspector needs in order to show a mapping that
 * failed rather than one that silently produced null.
 */

/**
 * Australia including its offshore state waters, as a coarse bounding box. Excludes the
 * external territories (Christmas, Cocos, Norfolk, Heard, Macquarie) — a record from one of
 * those is a warning here rather than an error precisely because the box, not the record, is
 * likely to be what is wrong.
 */
const AUS_BBOX = { minLat: -44.0, maxLat: -9.0, minLon: 112.0, maxLon: 154.0 };

export function validateRecord(record: CanonicalRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!record.provenance.sourceRecordId) {
    issues.push({
      field: "provenance.sourceRecordId",
      severity: "error",
      code: "MISSING_SOURCE_RECORD_ID",
      message: "no source record identifier — the record cannot be attributed or de-duplicated",
    });
  }

  if (!record.scientificName) {
    issues.push({
      field: "scientificName",
      severity: "error",
      code: "MISSING_SCIENTIFIC_NAME",
      message: "no scientific name",
    });
  }

  const { decimalLatitude: lat, decimalLongitude: lon } = record;
  if (lat === null || lon === null) {
    issues.push({
      field: "decimalLatitude/decimalLongitude",
      severity: "warning",
      code: "MISSING_COORDINATES",
      message: "record has no usable coordinate pair",
    });
  } else {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      issues.push({
        field: "decimalLatitude/decimalLongitude",
        severity: "error",
        code: "COORDINATES_OUT_OF_RANGE",
        message: `coordinates are not a valid point on Earth: ${lat}, ${lon}`,
      });
    } else if (
      lat < AUS_BBOX.minLat ||
      lat > AUS_BBOX.maxLat ||
      lon < AUS_BBOX.minLon ||
      lon > AUS_BBOX.maxLon
    ) {
      issues.push({
        field: "decimalLatitude/decimalLongitude",
        severity: "warning",
        code: "OUTSIDE_AUSTRALIA_BBOX",
        message: `coordinates fall outside the coarse Australian bounding box: ${lat}, ${lon}`,
      });
    }
  }

  if (
    record.coordinateUncertaintyInMeters !== null &&
    record.coordinateUncertaintyInMeters < 0
  ) {
    issues.push({
      field: "coordinateUncertaintyInMeters",
      severity: "warning",
      code: "NEGATIVE_UNCERTAINTY",
      message: `negative coordinate uncertainty: ${record.coordinateUncertaintyInMeters}`,
    });
  }

  if (record.eventDate === null) {
    issues.push({
      field: "eventDate",
      severity: "warning",
      code: "MISSING_EVENT_DATE",
      message: "no event date",
    });
  } else {
    const eventTime = Date.parse(record.eventDate);
    if (Number.isNaN(eventTime)) {
      issues.push({
        field: "eventDate",
        severity: "error",
        code: "UNPARSEABLE_EVENT_DATE",
        message: `event date could not be parsed: ${record.eventDate}`,
      });
    } else if (eventTime > Date.now()) {
      issues.push({
        field: "eventDate",
        severity: "warning",
        code: "FUTURE_EVENT_DATE",
        message: `event date is in the future: ${record.eventDate}`,
      });
    }
  }

  if (record.individualCount !== null && record.individualCount < 0) {
    issues.push({
      field: "individualCount",
      severity: "warning",
      code: "NEGATIVE_INDIVIDUAL_COUNT",
      message: `negative individual count: ${record.individualCount}`,
    });
  }

  return issues;
}
