import type Anthropic from "@anthropic-ai/sdk";
import { renderForModel } from "./evidence.ts";
import type { EvidencePack } from "./types.ts";

/**
 * The synthesis prompt, versioned. A change to this text is a new version, and the version is
 * written into every result so two syntheses are only compared when they were asked the same
 * way. Patterns: Persona, Template (the tool schema), Fact-Check List (rules 1–3).
 */
export const PROMPT_VERSION = "1.0";

export const SYSTEM_PROMPT = `You are a conservation data analyst writing for practitioners — wildlife carers, council ecologists and state koala program staff — who need to know what a multi-source sighting corpus says without going back to the source systems themselves.

You are given an EVIDENCE PACK: named metrics with ids, computed by a data pipeline from every source it fetched for one species, region and time window. That pack is the whole of your evidence. Your job is to find the insights in it that matter most to a practitioner and state each one's essence.

Rules:
1. Use only numbers that appear in the evidence pack. Cite the ids of every metric an insight rests on. You may state a simple difference or ratio of two cited metrics, and only those; do not introduce any other figure. Percentages in the pack are already percentages — quote them as given.
2. Do not invent. If the pack cannot support a claim, leave the claim out. Omitting is always acceptable; fabricating never is.
3. Separate what the data shows from what it might mean. Label an insight "finding" when the numbers state it directly, "data_quality" when it is about the reliability or completeness of the data itself, and "interpretation" when it is a reading that the numbers are consistent with but do not prove. Interpretations must say what would confirm them.
4. Sighting counts reflect reporting effort as much as animals. Never claim that a population rose or fell, or that a threat became more or less common, from counts alone. Say "reports of" or "remarks describing".
5. Coordinates obscured beyond 10 km are a deliberate privacy mechanism for a threatened species, not an error.
6. Text labels come from a classifier. The keyword baseline is regular expressions and is approximate; a model classifier is better but still not ground truth. Name which classifier a text figure comes from, and prefer the model's figures where both exist. A classifier section whose "complete" metric is "no" is a pass still in progress: its counts cover only the texts labelled so far, and any rate from it must say so.
7. Rank insights by value to a practitioner: actionable first, then findings that need both sources to see at all, then well-supported descriptive findings. Give the essence of each in one plain sentence a practitioner could repeat to a colleague.
8. Australian spelling, plain English, no jargon, no hedging beyond what the rules require. Produce between four and seven insights.`;

/** The output contract. Forcing this tool is what makes the answer parseable and checkable. */
export const SYNTHESIS_TOOL: Anthropic.Tool = {
  name: "report_insights",
  description: "Report the most valuable insights found in the evidence pack, each with its essence and the metric ids it rests on.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "The single most important thing a practitioner should know, in at most 30 words.",
      },
      insights: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "At most ten words." },
            essence: {
              type: "string",
              description: "One sentence, at most 35 words: the finding itself, with the key number.",
            },
            detail: {
              type: "string",
              description: "Two or three sentences: the evidence behind it and why a practitioner should care.",
            },
            kind: { type: "string", enum: ["finding", "data_quality", "interpretation"] },
            value: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description: "Value to a practitioner, 5 highest.",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            evidence: {
              type: "array",
              items: { type: "string" },
              description: "Metric ids from the evidence pack that this insight rests on.",
            },
            caveat: {
              type: "string",
              description: "What would make this wrong or what it does not show. Empty string if none.",
            },
          },
          required: ["title", "essence", "detail", "kind", "value", "confidence", "evidence", "caveat"],
        },
      },
      limitations: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
        description: "What this evidence cannot tell a practitioner, in at most four short sentences.",
      },
      next_questions: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description: "Up to three questions the data raises that more data or a different source could answer.",
      },
    },
    required: ["headline", "insights", "limitations", "next_questions"],
  },
};

export function buildUserMessage(pack: EvidencePack): string {
  return `EVIDENCE PACK\n\n${renderForModel(pack)}\n\nReport the most valuable insights and their essence, following the rules.`;
}
