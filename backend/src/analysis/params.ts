/**
 * Parameters for the calculated arm — every threshold and window in one versioned place, written
 * into each run's `params` so a result can always be traced to the settings that produced it.
 *
 * These are the defaults recorded in CLAUDE.md (3 Oct 2026). Change a value → bump the version.
 */
export const CALCULATED_PARAMS = {
  version: "2026-10-04.3",
  // .3 (4 Oct 2026): insight #4, regional co-movement, added.
  // .2 (4 Oct 2026): insight #3, reporting-rate trend, added.
  // .1 (4 Oct 2026): every date window on the record's Australian Eastern local date (event_day),
  // not its UTC date; managed populations set per taxon and state as well as per dataset
  // (corpus.managed_populations); range change from wild records only. All three found by
  // adjudicating the first AI-arm runs.

  /** The month a report is "for". The corpus runs to the end of September 2026. */
  reportMonth: "2026-09",

  /** Tier threshold (mirrors corpus.taxon_tiers): records since 2015 to qualify for #2–#5. */
  statisticalTierMinRecords: 100,

  /** Pre-fire reference period, Jan 2015 – Dec 2019. */
  baseline: { start: "2015-01-01", end: "2019-12-31" },

  silentSpecies: {
    /** A taxon is silent if it has no record in this many months up to the report month's end. */
    lookbackMonths: 36,
    /** An evidence gap: fewer analysable records than this since 2015. */
    evidenceGapMaxRecords: 10,
    /** Regional silence needs this many baseline records in the region to mean anything. */
    regionalMinBaselineRecords: 5,
  },

  rangeChange: {
    /**
     * Range metrics depend on how many years go into them, so the two windows are equal length:
     * the last three baseline years against three settled recent years. 2025–26 are excluded as
     * still filling in (publication lag).
     */
    baselineWindow: { start: "2017-01-01", end: "2019-12-31" },
    recentWindow: { start: "2022-01-01", end: "2024-12-31" },
    /** IUCN criterion B grid. Only records located to within this many metres count towards it. */
    aooFineCellM: 2_000,
    /** Range is a wild-trend measure: managed populations (fenced havens, reintroductions) are left out. */
    wildOnly: true,
    /** Coarser grid every record can contribute to, robust to ~10 km sensitive-species blurring. */
    aooCoarseCellM: 10_000,
    /** Flag a change at least this large in the coarse AOO (cf. IUCN's 30% decline threshold). */
    flagChange: 0.3,
    /** Both windows need at least this many records for a flag to be raised. */
    minRecordsPerWindow: 20,
    /** Below this share of precise records in either window, the 2 km figure is marked unreliable. */
    minPreciseShareForFineAoo: 0.5,
  },

  reportingRate: {
    // Windows are rangeChange's: equal-length settled periods, 2025–26 excluded as still filling in.
    /** Wild records only, as for range change. */
    wildOnly: true,
    /** Flag a decline at or below this detection ratio (the IUCN-style 30% change)… */
    declineRatio: 0.7,
    /** …and an increase at or above its reciprocal, so the two are symmetric on a log scale. */
    increaseRatio: 1 / 0.7,
    /** 95% interval for the ratio; a flag needs it to exclude 1. */
    z: 1.96,
    /** Consistent-source detections (cell-months with a record) needed in each window to flag. */
    minDetectionsPerWindow: 20,
    /** Records (all sources) in each window for a taxon–region pair to be assessed at all. */
    minRecordsPerWindow: 20,
  },

  coMovement: {
    /** A region is flagged only when at least this many taxa moved the same way… */
    minTaxa: 3,
    /** …and the binomial upper tail against the national share is below this. */
    alpha: 0.05,
  },

  notableRecords: {
    /** Further than this from every earlier record of the taxon. */
    outsideRangeKm: 100,
    /** A calendar month holding less than this share of the taxon's baseline records. */
    outOfSeasonMaxShare: 0.01,
    /** Seasonality is only judged with at least this many baseline records. */
    seasonMinBaselineRecords: 100,
  },
} as const;

export type CalculatedParams = typeof CALCULATED_PARAMS;

/** First and last day of a "YYYY-MM" month. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
}
