import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGESTION } from "../config/ingestion.ts";
import { sha256 } from "../snapshot/store.ts";
import { scrubForModel } from "./scrub.ts";
import { TAXONOMY_VERSION } from "./taxonomy.ts";
import type { Condition, EventCode, Subject, TextClassifier } from "./types.ts";

/**
 * Tier 1 — the synthetic corpus.
 *
 * Authored remarks whose correct label is known by construction: the constructed substitute
 * for a hand-labelled gold set, and what "hard evidence that the mechanism works" means in
 * this project. It deliberately spans the cases wild data rarely supplies in quantity —
 * negation, typos, vernacular, confusable species, mortality versus live sighting, boilerplate
 * that should classify as nothing — and a few traps built from real failure modes ("Fire
 * Trail", a dog that is merely present, a dead tree).
 *
 * Reported per case type, so the failure taxonomy falls out of the same run. Its stated
 * limitation: it proves correctness on constructed cases, not generalisation to wild data,
 * which is what the adjudicated sample of real classifications is for.
 */

export type CaseType =
  | "plain"
  | "negation"
  | "typo"
  | "vernacular"
  | "confusable_species"
  | "mortality"
  | "boilerplate"
  | "trap"
  | "compound";

export interface SyntheticCase {
  id: string;
  caseType: CaseType;
  text: string;
  expected: { subject: Subject; condition: Condition; events: EventCode[] };
}

const c = (
  id: string,
  caseType: CaseType,
  text: string,
  subject: Subject,
  condition: Condition,
  events: EventCode[] = [],
): SyntheticCase => ({ id, caseType, text, expected: { subject, condition, events } });

export const SYNTHETIC_CORPUS: SyntheticCase[] = [
  // --- plain, one signal each
  c("p01", "plain", "Adult koala sitting in a tallowwood, looked healthy and alert.", "koala", "alive_healthy"),
  c("p02", "plain", "Koala on the ground beside the driveway, appeared very sick with weeping eyes.", "koala", "alive_unwell", ["disease"]),
  c("p03", "plain", "Found dead at the base of a large blue gum this morning.", "koala", "dead"),
  c("p04", "plain", "Female with a joey on her back moving between trees at dusk.", "koala", "alive_healthy", ["with_joey"]),
  c("p05", "plain", "Koala hit by a car on the Pacific Highway near the school, taken to the vet.", "koala", "alive_unwell", ["vehicle_strike", "rescue_or_care"]),
  c("p06", "plain", "Attacked by two dogs in a backyard, rescued by WIRES and now in care.", "koala", "alive_unwell", ["dog_attack", "rescue_or_care"]),
  c("p07", "plain", "Burnt koala found after the bushfire, singed fur, taken to the koala hospital.", "koala", "alive_unwell", ["fire", "injury", "rescue_or_care"]),
  c("p08", "plain", "Koala sleeping in fork of tree, no interaction.", "koala", "alive_healthy"),
  c("p09", "plain", "Deceased koala on the road shoulder, appears to have been hit by a vehicle.", "koala", "dead", ["vehicle_strike"]),
  c("p10", "plain", "Released back into the reserve fully recovered after six weeks of treatment for chlamydia.", "koala", "alive_healthy", ["rescue_or_care", "disease"]),

  // --- negation
  c("n01", "negation", "Koala on the ground but no sign of injury, climbed away when approached.", "koala", "alive_healthy"),
  c("n02", "negation", "Checked closely, not sick, eyes clear, just resting low in the tree.", "koala", "alive_healthy"),
  c("n03", "negation", "No dog attack this time, the fence held, koala moved on unharmed.", "koala", "alive_healthy"),
  c("n04", "negation", "Wasn't hit by the car, driver stopped in time and it crossed safely.", "koala", "alive_healthy"),
  c("n05", "negation", "Not a koala, on closer look it was a large brushtail possum.", "not_koala", "unknown"),
  c("n06", "negation", "No joey visible this year, single adult only.", "koala", "unknown"),

  // --- typos and abbreviations
  c("t01", "typo", "Kaola hit by car near servo, still breatheing, wires notified.", "koala", "alive_unwell", ["vehicle_strike", "rescue_or_care"]),
  c("t02", "typo", "Helthy looking adult, feeding on gum leaves.", "koala", "alive_healthy"),
  c("t03", "typo", "Ded koala on rd, prob roadkill.", "koala", "dead", ["vehicle_strike"]),
  c("t04", "typo", "Mum w/ joey on bak, both fine.", "koala", "alive_healthy", ["with_joey"]),
  c("t05", "typo", "Conjuntivitis both eyes, very thin, needs a carer.", "koala", "alive_unwell", ["disease", "rescue_or_care"]),

  // --- vernacular
  c("v01", "vernacular", "Roadkill on the highway, sad sight.", "koala", "dead", ["vehicle_strike"]),
  c("v02", "vernacular", "Wet bottom and dirty rump, classic chlamydia, reported to Friends of the Koala.", "koala", "alive_unwell", ["disease", "rescue_or_care"]),
  c("v03", "vernacular", "Had to be put down by the vet after the dog got it.", "koala", "dead", ["dog_attack", "rescue_or_care"]),
  c("v04", "vernacular", "Back young riding along, mum looked in good nick.", "koala", "alive_healthy", ["with_joey"]),
  c("v05", "vernacular", "Fireground survivor, fur scorched on one side, otherwise mobile.", "koala", "alive_unwell", ["fire", "injury"]),

  // --- confusable species
  c("s01", "confusable_species", "Thought it was a koala from the car but it turned out to be a wombat.", "not_koala", "unknown"),
  c("s02", "confusable_species", "Grey lump in the tree, definitely a koala not a possum this time, awake and looking around.", "koala", "alive_healthy"),
  c("s03", "confusable_species", "Ringtail possum drey nearby, koala itself was two trees over and healthy.", "koala", "alive_healthy"),
  c("s04", "confusable_species", "Misidentified: the animal was a greater glider.", "not_koala", "unknown"),

  // --- mortality versus live
  c("m01", "mortality", "Alive but barely, hit overnight, euthanised at the clinic.", "koala", "dead", ["vehicle_strike", "rescue_or_care"]),
  c("m02", "mortality", "Found alive on the road, transported to hospital, survived.", "koala", "alive_unwell", ["rescue_or_care"]),
  c("m03", "mortality", "Carcass beside fence line, old, no obvious cause.", "koala", "dead"),
  c("m04", "mortality", "Looked dead from a distance but was just asleep, moved when we got close.", "koala", "alive_healthy"),

  // --- boilerplate that should classify as nothing
  c("b01", "boilerplate", "Reported to hotline.", "unclear", "unknown"),
  c("b02", "boilerplate", "Koala sighting.", "koala", "unknown"),
  c("b03", "boilerplate", "Observed during survey transect 4.", "koala", "unknown"),
  c("b04", "boilerplate", "See attached photo.", "unclear", "unknown"),
  c("b05", "boilerplate", "Lot 12 DP 123456, property boundary.", "unclear", "unknown"),

  // --- traps built from real failure modes
  c("x01", "trap", "Koala in ironbark near Fire Trail Road, active and healthy.", "koala", "alive_healthy"),
  c("x02", "trap", "Our dog was barking at it for an hour; koala stayed up the tree, unbothered.", "koala", "alive_healthy"),
  c("x03", "trap", "Sitting in a dead tree on the ridge, looked fine.", "koala", "alive_healthy"),
  c("x04", "trap", "Crossed the road slowly, traffic stopped, reached the other side.", "koala", "alive_healthy"),
  c("x05", "trap", "Koala Hospital volunteers ran a talk here last week; this animal was wild and healthy.", "koala", "alive_healthy"),
  c("x06", "trap", "Dead end street, koala in the last gum on the left, awake.", "koala", "alive_healthy"),

  // --- compound
  c("c01", "compound", "Mother with joey hit by car, mother dead, joey alive and taken into care.", "koala", "dead", ["vehicle_strike", "with_joey", "rescue_or_care"]),
  c("c02", "compound", "Dog attack victim, puncture wounds on back, treated and released after two weeks.", "koala", "alive_unwell", ["dog_attack", "injury", "rescue_or_care"]),
  c("c03", "compound", "Post-fire survey: one live koala, thin and dehydrated, in a burnt patch of forest.", "koala", "alive_unwell", ["fire"]),
];

export interface EvaluationReport {
  classifier: string;
  model: string | null;
  promptVersion: string | null;
  taxonomyVersion: string;
  evaluatedAt: string;
  cases: number;
  /** A case passes only when subject, condition and the full event set all match. */
  passed: number;
  passRate: number;
  byCaseType: Record<string, { cases: number; passed: number; passRate: number }>;
  byComponent: { subject: number; condition: number; events: number };
  eventScores: Record<EventCode, { precision: number; recall: number; tp: number; fp: number; fn: number }>;
  failures: {
    id: string;
    caseType: CaseType;
    text: string;
    expected: SyntheticCase["expected"];
    actual: SyntheticCase["expected"] & { confidence: number; evidence: string };
  }[];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export async function evaluateClassifier(classifier: TextClassifier): Promise<EvaluationReport> {
  const items = SYNTHETIC_CORPUS.map((sc) => {
    const text = scrubForModel(sc.text).text;
    return { sc, item: { textHash: sha256(text), text } };
  });
  const labels = await classifier.classify(items.map((i) => i.item));

  const byCaseType: EvaluationReport["byCaseType"] = {};
  const byComponent = { subject: 0, condition: 0, events: 0 };
  const eventScores = Object.fromEntries(
    (["vehicle_strike", "dog_attack", "disease", "injury", "fire", "rescue_or_care", "with_joey"] as EventCode[]).map((e) => [
      e,
      { precision: 0, recall: 0, tp: 0, fp: 0, fn: 0 },
    ]),
  ) as EvaluationReport["eventScores"];
  const failures: EvaluationReport["failures"] = [];
  let passed = 0;

  for (const { sc, item } of items) {
    const label = labels.get(item.textHash)!;
    const subjectOk = label.subject === sc.expected.subject;
    const conditionOk = label.condition === sc.expected.condition;
    const eventsOk = sameSet(label.events, sc.expected.events);
    if (subjectOk) byComponent.subject++;
    if (conditionOk) byComponent.condition++;
    if (eventsOk) byComponent.events++;
    const ok = subjectOk && conditionOk && eventsOk;

    const bucket = (byCaseType[sc.caseType] ??= { cases: 0, passed: 0, passRate: 0 });
    bucket.cases++;
    if (ok) {
      passed++;
      bucket.passed++;
    } else {
      failures.push({
        id: sc.id,
        caseType: sc.caseType,
        text: sc.text,
        expected: sc.expected,
        actual: { subject: label.subject, condition: label.condition, events: label.events, confidence: label.confidence, evidence: label.evidence },
      });
    }

    for (const e of Object.keys(eventScores) as EventCode[]) {
      const expected = sc.expected.events.includes(e);
      const actual = label.events.includes(e);
      if (expected && actual) eventScores[e].tp++;
      else if (!expected && actual) eventScores[e].fp++;
      else if (expected && !actual) eventScores[e].fn++;
    }
  }

  for (const bucket of Object.values(byCaseType)) bucket.passRate = bucket.passed / bucket.cases;
  for (const s of Object.values(eventScores)) {
    s.precision = s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
    s.recall = s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
  }

  const report: EvaluationReport = {
    classifier: classifier.key,
    model: classifier.model,
    promptVersion: classifier.promptVersion,
    taxonomyVersion: TAXONOMY_VERSION,
    evaluatedAt: new Date().toISOString(),
    cases: items.length,
    passed,
    passRate: passed / items.length,
    byCaseType,
    byComponent,
    eventScores,
    failures,
  };

  const dir = path.resolve(process.cwd(), INGESTION.dataDir, "evaluations");
  await mkdir(dir, { recursive: true });
  const stamp = report.evaluatedAt.replace(/[:.]/g, "-");
  await writeFile(path.join(dir, `${classifier.key}-${stamp}.json`), JSON.stringify(report, null, 2), "utf8");
  return report;
}
