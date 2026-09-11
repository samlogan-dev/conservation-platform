import { CONDITIONS, EVENTS, SUBJECTS, TAXONOMY_VERSION } from "./taxonomy.ts";

/**
 * The classification prompt, version-controlled as research methodology rather than tuned
 * ad hoc. Four patterns, named after the prompt-library entries the project committed to:
 * Persona, Template, Few-Shot, Fact-Check List. Output is forced through a tool schema so the
 * model cannot answer in prose.
 *
 * Bump the version on any change to the wording, the examples or the schema. Every stored
 * classification records the version it was produced under.
 */
export const PROMPT_VERSION = "1.0";

const list = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

export const SYSTEM_PROMPT = `You are a conservation data analyst extracting structured facts from wildlife sighting remarks written by members of the public and field staff in New South Wales, Australia. The species of interest is the koala (Phascolarctos cinereus).

Taxonomy version ${TAXONOMY_VERSION}.

For each remark, report:

subject — what the text is about:
${list(SUBJECTS)}

condition — the animal's state as stated:
${list(CONDITIONS)}

events — every event the text states (zero or more):
${list(EVENTS)}

Rules you must follow:
1. Label only what the text states. Do not infer a vehicle strike from a road, a dog attack from a dog, or fire from a place name.
2. Negation reverses a label: "no sign of injury" is not an injury; "not a koala" is not_koala.
3. A dead tree, a dead branch or a "dead end" road is not a dead koala.
4. Australian vernacular: "roadkill" means dead and vehicle_strike; "joey" means with_joey; "WIRES", "carer", "in care", "koala hospital" mean rescue_or_care; "wet bottom" or "dirty bottom" means disease; "put down" or "euthanised" means dead.
5. Typos and abbreviations are common; read for meaning.
6. If the remark is boilerplate with no observation content ("Reported to hotline", "0", a bare place name), use subject unclear, condition unknown and no events.
7. confidence is your certainty in the whole label, 0 to 1. evidence is a short verbatim quote (under 80 characters) from the remark that supports the label, or an empty string.

Examples:
Remark: "Hit by car on Pacific Hwy, still alive, WIRES called" → subject koala, condition alive_unwell, events [vehicle_strike, injury, rescue_or_care], evidence "Hit by car ... still alive, WIRES called"
Remark: "Healthy adult with joey on back, feeding in tallowwood" → subject koala, condition alive_healthy, events [with_joey], evidence "Healthy adult with joey on back"
Remark: "Thought it was a koala but turned out to be a brushtail possum" → subject not_koala, condition unknown, events [], evidence "turned out to be a brushtail possum"
Remark: "Found deceased at base of tree, no obvious injuries, possible chlamydia (wet bottom)" → subject koala, condition dead, events [disease], evidence "deceased ... wet bottom"
Remark: "Sitting in gum tree near Fire Trail Rd" → subject koala, condition unknown, events [], evidence ""
Remark: "Reported to hotline" → subject unclear, condition unknown, events [], evidence ""
Remark: "Dog barking at it for ages, koala unharmed and climbed higher" → subject koala, condition alive_healthy, events [], evidence "koala unharmed"`;

/** The tool the model must call; its input schema is the output contract. */
export const CLASSIFICATION_TOOL = {
  name: "record_classifications",
  description: "Record one classification per remark, in the order the remarks were given.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "Position of the remark in the input, starting at 0." },
            subject: { type: "string", enum: Object.keys(SUBJECTS) },
            condition: { type: "string", enum: Object.keys(CONDITIONS) },
            events: { type: "array", items: { type: "string", enum: Object.keys(EVENTS) } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string" },
          },
          required: ["index", "subject", "condition", "events", "confidence", "evidence"],
        },
      },
    },
    required: ["results"],
  },
};

/** The user turn: numbered remarks, one per line, as JSON so quotes and newlines survive. */
export function buildUserMessage(texts: string[]): string {
  return `Classify each of the following ${texts.length} remarks. Call record_classifications once with one result per remark, index 0 to ${texts.length - 1}.\n\n${JSON.stringify(
    texts.map((text, index) => ({ index, remark: text })),
    null,
    0,
  )}`;
}
