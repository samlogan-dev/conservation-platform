import { runAlaHarvest } from "./ala/harvest.ts";
import { adaptAlaPage } from "./ala/adapter.ts";
import type { SourceModule } from "./types.ts";

/**
 * The source registry.
 *
 * Everything above this line is source-specific and everything below it is shared. Adding a
 * source means writing a harvester and an adapter and adding a line here — no change to the
 * canonical record, the snapshot store or the analysis. ALA is the only source; the seam is
 * kept because it costs nothing and a second source is not ruled out.
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
};

export function getSource(key: string): SourceModule {
  const source = SOURCES[key];
  if (!source) {
    throw new Error(`unknown source "${key}" — known: ${Object.keys(SOURCES).join(", ")}`);
  }
  return source;
}
