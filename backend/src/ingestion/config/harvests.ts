import { SPECIES } from "./species.ts";
import { REGIONS } from "./regions.ts";

/**
 * Harvest definitions. A harvest is a named, re-runnable query window — the unit that gets
 * frozen, so it is also the unit of reproducibility.
 *
 * Two kinds, matching the two ways records arrive (decided 3 Oct 2026):
 *  - `ala` — the search API, paged, one species per harvest. Used for small windows and for
 *    monthly increments. Bounded by ALA's 5,000-record reachable cap per query, which the
 *    harvester partitions around (see `sources/ala/harvest.ts`).
 *  - `ala-download` — ALA's offline bulk download: one query, any size, delivered as a zip and
 *    frozen as-is. Used for the 2015-to-now history. Needs ALA_DOWNLOAD_EMAIL.
 */
interface HarvestBase {
  key: string;
  description: string;
  /** Inclusive ISO dates bounding the observation date. */
  startDate: string;
  endDate: string;
}

export interface SpeciesHarvest extends HarvestBase {
  source: "ala";
  speciesKey: keyof typeof SPECIES | string;
  /** Omitted for an Australia-wide harvest. */
  regionKey?: keyof typeof REGIONS | string;
}

export interface DownloadHarvest extends HarvestBase {
  source: "ala-download";
  /** Filter queries beyond the date window, in ALA's syntax. */
  filters: string[];
  /**
   * Ask ALA to mint a DOI for the download. A DOI is permanent and public, so this is true only
   * for the corpus download the thesis cites — never for a test.
   */
  mintDoi: boolean;
}

export type HarvestDefinition = SpeciesHarvest | DownloadHarvest;

/** Nationally threatened, as ALA tags records with EPBC status. */
const NATIONALLY_THREATENED =
  'countryConservation:("Critically Endangered" OR "Endangered" OR "Vulnerable")';

export const HARVESTS: Record<string, HarvestDefinition> = {
  /** A small window for exercising the API path end to end. Not part of any corpus. */
  "smoke-swift-parrot-2025-01": {
    key: "smoke-swift-parrot-2025-01",
    description: "Smoke test — Swift Parrot occurrences, Australia-wide, January 2025, via ALA",
    source: "ala",
    speciesKey: "swiftParrot",
    startDate: "2025-01-01",
    endDate: "2025-01-31",
  },

  /** Exercises the download path on many species and datasets at once. Not part of any corpus. */
  "test-download-threatened-tas-2025-01": {
    key: "test-download-threatened-tas-2025-01",
    description: "Download test — nationally threatened taxa, Tasmania, January 2025",
    source: "ala-download",
    filters: [NATIONALLY_THREATENED, 'cl22:"Tasmania"'],
    startDate: "2025-01-01",
    endDate: "2025-01-31",
    mintDoi: false,
  },

  /**
   * The corpus: every record ALA tags as nationally threatened, observed 2015 to the end of the
   * last complete month at the time of definition. Later records arrive as monthly increments.
   */
  "threatened-2015-2026-09": {
    key: "threatened-2015-2026-09",
    description: "Corpus — nationally threatened taxa (EPBC CR/EN/VU), Australia, Jan 2015 – Sep 2026, via ALA bulk download",
    source: "ala-download",
    filters: [NATIONALLY_THREATENED],
    startDate: "2015-01-01",
    endDate: "2026-09-30",
    mintDoi: true,
  },
};

export const DEFAULT_HARVEST = "smoke-swift-parrot-2025-01";
