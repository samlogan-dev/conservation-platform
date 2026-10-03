import { runAlaHarvest } from "./ala/harvest.ts";
import { adaptAlaPage } from "./ala/adapter.ts";
import { runAlaDownload } from "./ala/download.ts";
import { streamAlaDownload } from "./ala/downloadReader.ts";
import type { SourceModule } from "./types.ts";

/**
 * The source registry.
 *
 * Everything above this line is source-specific and everything below it is shared. Adding a
 * source means writing a harvester and an adapter and adding a line here — no change to the
 * canonical record, the snapshot store or the analysis. ALA is the only source, reached two
 * ways — the paged search API and the bulk download — which share one adapter.
 */
export const SOURCES: Record<string, SourceModule> = {
  ala: {
    key: "ala",
    label: "Atlas of Living Australia",
    harvest: runAlaHarvest,
    adaptPage: adaptAlaPage,
  },
  "ala-download": {
    key: "ala-download",
    label: "Atlas of Living Australia (bulk download)",
    harvest: runAlaDownload,
    streamRecords: streamAlaDownload,
  },
};

export function getSource(key: string): SourceModule {
  const source = SOURCES[key];
  if (!source) {
    throw new Error(`unknown source "${key}" — known: ${Object.keys(SOURCES).join(", ")}`);
  }
  return source;
}
