/**
 * The species registry.
 *
 * The project now covers as many Australian threatened species as ALA holds good data for,
 * and which species — and whether they are listed here one by one or selected by a query
 * such as a conservation-status filter — is not yet decided. The entries below are ALA taxon
 * names already verified against the live API, kept so the pipeline can be exercised end to
 * end; they are not a working set.
 */
export interface Species {
  key: string;
  scientificName: string;
  vernacularName: string;
  /** Exactly as ALA's `taxon_name` index expects it. Verified against the live API. */
  alaTaxonName: string;
}

export const SPECIES: Record<string, Species> = {
  koala: {
    key: "koala",
    scientificName: "Phascolarctos cinereus",
    vernacularName: "Koala",
    alaTaxonName: "Phascolarctos cinereus",
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
