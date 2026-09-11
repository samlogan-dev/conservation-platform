import { SPECIES } from "./species.ts";
import { REGIONS } from "./regions.ts";

/**
 * Harvest definitions. A harvest is a named, re-runnable query window — the unit that gets
 * frozen, so it is also the unit of reproducibility.
 */
export interface HarvestDefinition {
  key: string;
  description: string;
  /** Key into the source registry — decides which adapter and harvester run. */
  source: "ala" | "inaturalist";
  speciesKey: keyof typeof SPECIES | string;
  regionKey: keyof typeof REGIONS | string;
  /** Inclusive ISO dates bounding the observation date. */
  startDate: string;
  endDate: string;
}

/**
 * Stage 1: Koala x Atlas of Living Australia, windowed to NSW and a recent six months.
 *
 * The window was chosen against live record counts, not guessed: NSW koala records run
 * ~400-600/month, so 2025-H1 lands at ~2,865 records — the "low thousands" Stage 1 asks for,
 * small enough to re-run while the schema is still changing every ten minutes.
 *
 * Koala rather than the other two because its records come from many contributing data
 * resources at once (five in a single month of this window), so one query already delivers
 * the schema drift and inconsistent field population the adapter exists to handle.
 */
export const HARVESTS: Record<string, HarvestDefinition> = {
  "koala-nsw-2025h1": {
    key: "koala-nsw-2025h1",
    description: "Stage 1 — Koala occurrences in New South Wales, Jan–Jun 2025, via ALA",
    source: "ala",
    speciesKey: "koala",
    regionKey: "nsw",
    startDate: "2025-01-01",
    endDate: "2025-06-30",
  },

  /**
   * Stage 2: the same species, region and window through a second source, so the two corpora
   * are comparable record-for-record rather than merely both existing.
   *
   * iNaturalist rather than GBIF because GBIF is cheap precisely for the reason it is a weak
   * test — it speaks the same Darwin Core vocabulary, and its Australian koala records are
   * largely ALA data round-tripped. iNaturalist is not Darwin Core, brings its own auth,
   * paging and vocabulary, and is where the free text lives.
   */
  "koala-nsw-2025h1-inat": {
    key: "koala-nsw-2025h1-inat",
    description: "Stage 2 — Koala observations in New South Wales, Jan–Jun 2025, via iNaturalist",
    source: "inaturalist",
    speciesKey: "koala",
    regionKey: "nsw",
    startDate: "2025-01-01",
    endDate: "2025-06-30",
  },
};

/**
 * Backfill (11 Sep 2026): koala x NSW, one harvest per calendar year from 2015, per source.
 *
 * One run per year rather than one ten-year run so a failure stays small and re-runnable, and
 * so each year is its own family for the cross-source pages. 2015 is where iNaturalist starts
 * to carry a signal (58 NSW koala observations that year); ALA's counts by year, taken live on
 * 11 Sep 2026, run from ~5,000 in 2015 to 77,576 in 2024, the latter almost entirely a BioNet
 * survey-programme load. Historical years are frozen once and never re-run; the current year
 * is re-run on demand, and the difference between its runs is the publication lag.
 */
const BACKFILL_FROM = 2015;
const BACKFILL_TO = 2026;

for (let year = BACKFILL_FROM; year <= BACKFILL_TO; year++) {
  const window = { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  HARVESTS[`koala-nsw-${year}`] = {
    key: `koala-nsw-${year}`,
    description: `Koala occurrences in New South Wales, ${year}, via ALA`,
    source: "ala",
    speciesKey: "koala",
    regionKey: "nsw",
    ...window,
  };
  HARVESTS[`koala-nsw-${year}-inat`] = {
    key: `koala-nsw-${year}-inat`,
    description: `Koala observations in New South Wales, ${year}, via iNaturalist`,
    source: "inaturalist",
    speciesKey: "koala",
    regionKey: "nsw",
    ...window,
  };
}

export const DEFAULT_HARVEST = "koala-nsw-2025h1";
