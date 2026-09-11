import { runAlaHarvest } from "./ala/harvest.ts";
import { adaptAlaPage } from "./ala/adapter.ts";
import { runInaturalistHarvest } from "./inaturalist/harvest.ts";
import { adaptInaturalistPage } from "./inaturalist/adapter.ts";
import type { SourceModule } from "./types.ts";

/**
 * The source registry.
 *
 * Everything above this line is source-specific and everything below it is shared. Adding a
 * source means writing a harvester and an adapter and adding a line here — no change to the
 * canonical record, the snapshot store, the analysis or the views. That was the architectural
 * claim Stage 1 made and could not test with one source; this is where it either holds or does
 * not.
 */
export const SOURCES: Record<string, SourceModule> = {
  ala: {
    key: "ala",
    label: "Atlas of Living Australia",
    recordsKey: "occurrences",
    recordIdField: "uuid",
    harvest: runAlaHarvest,
    adaptPage: adaptAlaPage,
  },
  inaturalist: {
    key: "inaturalist",
    label: "iNaturalist",
    recordsKey: "results",
    recordIdField: "id",
    harvest: runInaturalistHarvest,
    adaptPage: adaptInaturalistPage,
  },
};

export function getSource(key: string): SourceModule {
  const source = SOURCES[key];
  if (!source) {
    throw new Error(`unknown source "${key}" — known: ${Object.keys(SOURCES).join(", ")}`);
  }
  return source;
}
