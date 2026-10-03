/**
 * Ethics pillar 4 — ecological protection: never expose high-precision GPS for
 * poacher-sensitive species.
 *
 * Decided 29 Aug 2026: **fuzz at the API boundary, store precise.** Fuzzing at ingestion is
 * irreversible and would destroy coordinate precision as something the analysis can measure;
 * storing precise and fuzzing on the way out keeps both properties — nothing precise leaves
 * the backend, and the precise value remains available to the checks that need it.
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
