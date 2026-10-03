/**
 * What kind of record this is — the channel it entered through, not the aggregator it arrived by.
 *
 * Added 2 Oct 2026 for the portal, which merges the sources into one corpus. Once ALA and
 * iNaturalist are one corpus, "which source" stops being a useful split for a reader. ALA is
 * a conduit, and 96.6% of its NSW koala records are one state database. What does change how
 * a record should be read is how it was made:
 *
 *   - a rescue or rehabilitation record is about a sick or injured animal by construction, so
 *     it inflates any "share of sightings describing harm" it is blended into;
 *   - a government database is dominated by monitoring programmes, so its volume tracks
 *     survey effort more than it tracks koalas;
 *   - a public sighting is someone who happened to see a koala.
 *
 * **Limited by what the sources carry, and stated rather than guessed.** BioNet's own API
 * separates acoustic, drone, scientific-licence and public-app records (`observationType`,
 * dataset), but ALA's copy of BioNet carries none of that. All 240,000 BioNet records arrive
 * as one dataset, with internal catalogue prefixes whose meaning ALA does not publish. So the
 * one channel inside BioNet that can be told apart reliably — rescue and rehabilitation, by
 * its record numbers and encounter codes — is split out, and the rest stays together as
 * "government database". Separating monitoring from public reports inside it would need
 * BioNet's own API as a source.
 */
export type RecordType =
  | "government_database"
  | "public_sighting"
  | "rescue_rehab"
  | "survey_research"
  | "specimen"
  | "other";

/** Display order, largest channel first. */
export const RECORD_TYPES: Record<RecordType, { label: string; description: string }> = {
  government_database: {
    label: "Government database",
    description:
      "A state wildlife database (NSW BioNet; the Victorian Biodiversity Atlas): monitoring programmes, scientific-licence returns and public reports through government apps. ALA's copy does not say which.",
  },
  public_sighting: {
    label: "Public sighting",
    description:
      "Citizen-science platforms and community sighting schemes: iNaturalist, NatureMapr, ALA's own sightings app, council and community koala registers.",
  },
  rescue_rehab: {
    label: "Rescue & rehab",
    description:
      "An animal that came into care: a wildlife-rehabilitation record number, an encounter code, or a WIRES call sheet. About a sick or injured koala by construction.",
  },
  survey_research: {
    label: "Survey or research",
    description: "Targeted surveys and research projects outside the state databases: scat-DNA sampling, ecological monitoring, habitat-restoration projects.",
  },
  specimen: {
    label: "Museum specimen",
    description: "A preserved specimen in a museum collection, not a live observation.",
  },
  other: {
    label: "Other",
    description: "A dataset not yet assigned a type.",
  },
};

export const RECORD_TYPE_CODES = Object.keys(RECORD_TYPES) as RecordType[];

/**
 * Datasets by type, keyed by the source's dataset id. Every dataset in the 2015–2026 NSW koala
 * corpus is listed, so "other" means "new since this was written", not "not thought about".
 */
const DATASET_TYPES: Record<string, RecordType> = {
  // State wildlife databases.
  dr368: "government_database", // NSW BioNet Atlas
  dr1097: "government_database", // Victorian Biodiversity Atlas
  // Citizen science and community sighting schemes.
  inaturalist: "public_sighting", // iNaturalist, fetched directly
  dr1411: "public_sighting", // iNaturalist Australia, via ALA
  dr3147: "public_sighting", // Tweed Koala Sightings
  dr16115: "public_sighting", // Bangalow Koalas
  dr364: "public_sighting", // ALA species sightings and OzAtlas
  dr19123: "public_sighting", // NatureMapr
  dr4701: "public_sighting", // Koala Quest 2015
  dr1902: "public_sighting", // Earth Guardians Weekly Feed (QuestaGame)
  dr16872: "public_sighting", // City of Gold Coast Koala Sightings
  dr22510: "public_sighting", // Observation.org
  dr893: "public_sighting", // BowerBird
  dr2696: "public_sighting", // Koala Count
  // Surveys and research outside the state databases.
  dr31884: "survey_research", // Collective non-invasive Koala DNA sampling database
  dr499: "survey_research", // AWC Ecological Monitoring Surveys
  dr23684: "survey_research", // Cudgen Nature Reserve Habitat Restoration
  dr22562: "survey_research", // Warrumbungle Koala Project
  dr17831: "survey_research", // Northern Rivers Koala Habitat Restoration Project
  // dr340 (Australian Museum, OZCAM) is caught by basisOfRecord below.
};

/** BioNet's wildlife-rehabilitation records carry `WR…` record numbers ("WR1234567;…", "WRSydWildlife…"). */
const REHAB_RECORD_NUMBER = /^WR/i;
/** The rehab database's structured codes, and WIRES rescue call sheets, as they appear in remarks. */
const REHAB_REMARKS = /^\s*Encounter (broad|narrow)\s*:|\bWIRES call ?sheet\b/i;

export interface RecordTypeInputs {
  dataResourceUid: string | null;
  basisOfRecord: string | null;
  recordNumber: string | null;
  remarks: string | null;
}

/**
 * Content before dataset: a specimen is a specimen and a rescue is a rescue whichever dataset
 * carries it. Measured on 2019 and 2025: 2,342 and 418 records carry both a `WR` number and an
 * encounter code, and in 2019 a further 322 carry the number alone, so both signals are needed.
 */
export function recordTypeOf(r: RecordTypeInputs): RecordType {
  if (r.basisOfRecord && /specimen/i.test(r.basisOfRecord)) return "specimen";
  if ((r.recordNumber && REHAB_RECORD_NUMBER.test(r.recordNumber)) || (r.remarks && REHAB_REMARKS.test(r.remarks))) {
    return "rescue_rehab";
  }
  return (r.dataResourceUid && DATASET_TYPES[r.dataResourceUid]) || "other";
}
