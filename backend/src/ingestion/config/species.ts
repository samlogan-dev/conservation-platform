/**
 * The species registry.
 *
 * Working set as of 29 Aug 2026, chosen so each exercises a different mechanism rather than
 * being three instances of one. All three are provisional and none survives a record count
 * that comes back too thin — rationale in CLAUDE.md.
 *
 * Only the Koala is harvested in Stage 1. The other two are listed because the registry is
 * the right place for them and listing them costs nothing; nothing reads them yet.
 */
export interface Species {
  key: string;
  scientificName: string;
  vernacularName: string;
  /** Exactly as ALA's `taxon_name` index expects it. Verified against the live API. */
  alaTaxonName: string;
  /** iNaturalist numeric taxon id. Verified against /v1/taxa on 29 Aug 2026. */
  inatTaxonId?: number;
}

export const SPECIES: Record<string, Species> = {
  koala: {
    key: "koala",
    scientificName: "Phascolarctos cinereus",
    vernacularName: "Koala",
    alaTaxonName: "Phascolarctos cinereus",
    inatTaxonId: 42983,
  },
  greyHeadedFlyingFox: {
    key: "greyHeadedFlyingFox",
    scientificName: "Pteropus poliocephalus",
    vernacularName: "Grey-headed Flying-fox",
    alaTaxonName: "Pteropus poliocephalus",
  },
  swiftParrot: {
    key: "swiftParrot",
    scientificName: "Lathamus discolor",
    vernacularName: "Swift Parrot",
    alaTaxonName: "Lathamus discolor",
  },
};
