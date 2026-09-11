/**
 * Ethics pillar 4 — ecological protection: never expose high-precision GPS for
 * poacher-sensitive species.
 *
 * Where fuzzing applies was left open in the Build Scope. Decided here, 29 Aug 2026, for
 * Stage 1: **fuzz at the API boundary, store precise.**
 *
 * The reasoning is that fuzzing at ingestion is irreversible and would destroy the very thing
 * Stage 1 is trying to measure — coordinate precision is one of the fields whose coverage and
 * variability the stage exists to report on, and a Layer 1 check on "coordinate precision
 * within the fuzzing policy" cannot be written against already-fuzzed coordinates. Storing
 * precise and fuzzing on the way out keeps both properties: nothing precise leaves the
 * backend, and the precise value remains available to the checks that need it.
 *
 * The trade-off, recorded honestly: this puts the guarantee in the serialisation layer rather
 * than in the datastore, so it holds only as long as every response path applies it. That is
 * why fuzzing lives in one function that the route layer calls, rather than being sprinkled
 * across handlers.
 */

/** Decimal places retained. 2dp is ~1.1km at Australian latitudes — catchment/regional scale. */
const PUBLIC_PRECISION_DP = 2;

const round = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

export interface PublicCoordinates {
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  /** True when the values above were reduced from what is stored. */
  coordinatesFuzzed: boolean;
  /** Roughly how far the published point may sit from the true one, in metres. */
  fuzzedToApproxMetres: number | null;
}

export function toPublicCoordinates(
  latitude: number | null,
  longitude: number | null,
): PublicCoordinates {
  if (latitude === null || longitude === null) {
    return {
      decimalLatitude: null,
      decimalLongitude: null,
      coordinatesFuzzed: false,
      fuzzedToApproxMetres: null,
    };
  }
  return {
    decimalLatitude: round(latitude, PUBLIC_PRECISION_DP),
    decimalLongitude: round(longitude, PUBLIC_PRECISION_DP),
    coordinatesFuzzed: true,
    // One unit in the last retained place, expressed as distance at the equator.
    fuzzedToApproxMetres: Math.round(10 ** -PUBLIC_PRECISION_DP * 111_320),
  };
}
