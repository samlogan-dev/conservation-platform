import { SPECIES } from "./species.ts";
import { REGIONS } from "./regions.ts";

/**
 * Harvest definitions. A harvest is a named, re-runnable query window — the unit that gets
 * frozen, so it is also the unit of reproducibility.
 *
 * Still one species per harvest, which is how the ALA harvester queries today. How a
 * many-species, Australia-wide corpus is partitioned into harvests (per species, per taxon
 * group, by a conservation-status filter) is open; ALA's 5,000-record reachable cap per query
 * is the constraint any answer has to respect — see `sources/ala/harvest.ts`.
 */
export interface HarvestDefinition {
  key: string;
  description: string;
  /** Key into the source registry — decides which adapter and harvester run. */
  source: "ala";
  speciesKey: keyof typeof SPECIES | string;
  /** Omitted for an Australia-wide harvest. */
  regionKey?: keyof typeof REGIONS | string;
  /** Inclusive ISO dates bounding the observation date. */
  startDate: string;
  endDate: string;
}

export const HARVESTS: Record<string, HarvestDefinition> = {
  /** A small window for exercising the pipeline end to end. Not part of any corpus. */
  "smoke-swift-parrot-2025-01": {
    key: "smoke-swift-parrot-2025-01",
    description: "Smoke test — Swift Parrot occurrences, Australia-wide, January 2025, via ALA",
    source: "ala",
    speciesKey: "swiftParrot",
    startDate: "2025-01-01",
    endDate: "2025-01-31",
  },
};

export const DEFAULT_HARVEST = "smoke-swift-parrot-2025-01";
