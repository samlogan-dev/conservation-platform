import type { Condition, EventCode, Subject } from "./types.ts";

/**
 * The threat and condition taxonomy, declared as data so the prompt, the baseline, the
 * evaluation and the UI all read one definition. Versioned: a change here invalidates every
 * stored classification, which is the point of writing the version into each run.
 *
 * Deliberately small. Each category is something a practitioner would act on differently,
 * and each is something a sighting remark can actually state. Cause of death is not separated
 * from condition because the text rarely supports it; a dead koala beside a road is
 * `dead` + `vehicle_strike` only when the remark says it was hit.
 */
export const TAXONOMY_VERSION = "1.0";

export const SUBJECTS: Record<Subject, string> = {
  koala: "The text describes an observation of a koala.",
  not_koala:
    "The text says the animal was not a koala, or was misidentified (\"turned out to be a possum\"), or describes something else entirely.",
  unclear: "The text does not say enough to tell what was observed.",
};

export const CONDITIONS: Record<Condition, string> = {
  alive_healthy:
    "Alive and described as well: healthy, alert, active, feeding, moving normally, \"looks good\".",
  alive_unwell:
    "Alive but described as sick, injured, weak, thin, blind, burnt, or showing signs of disease.",
  dead: "Dead when observed, or died: carcass, roadkill, deceased, euthanised, found dead.",
  unknown: "The text does not state the animal's condition.",
};

export const EVENTS: Record<EventCode, string> = {
  vehicle_strike:
    "Hit by a car or other vehicle, or found as roadkill. Being near a road is not enough; the text must state a strike.",
  dog_attack: "Attacked, bitten or mauled by a dog. A dog merely being present is not an attack.",
  disease:
    "Signs of disease: chlamydia, conjunctivitis, cystitis, wet or dirty bottom, infection, described as sick or ill.",
  injury: "A physical injury other than from disease: wound, fracture, bleeding, burn.",
  fire: "Affected by bushfire: burnt, singed, found after fires, fire-damaged habitat. A place name containing \"Fire Trail\" is not fire.",
  rescue_or_care:
    "Taken into care, rescued, treated by a vet or carer, in hospital, released or relocated.",
  with_joey: "A joey, back young or pouch young present with the animal.",
};

export const EVENT_CODES = Object.keys(EVENTS) as EventCode[];
export const CONDITION_CODES = Object.keys(CONDITIONS) as Condition[];
export const SUBJECT_CODES = Object.keys(SUBJECTS) as Subject[];

/** Precedence when a record carries two labelled fields: the worse condition wins. */
export const CONDITION_RANK: Record<Condition, number> = {
  dead: 3,
  alive_unwell: 2,
  alive_healthy: 1,
  unknown: 0,
};
