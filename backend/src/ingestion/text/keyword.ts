import type { Condition, EventCode, TextClassifier, TextItem, TextLabel } from "./types.ts";

/**
 * The non-LLM baseline: regular expressions over the same taxonomy.
 *
 * This exists so the question "was a model worth paying for" has an answer. It is written to
 * be a fair baseline rather than a straw man — it handles simple negation and the obvious
 * traps (a "Fire Trail" locality, a dog that is merely present) — but it is rules, and the
 * synthetic corpus is where its limits are measured rather than argued about.
 */

/**
 * Negation within a couple of words before a match cancels it. The window stops at a comma or
 * clause break: "not sick, just resting" negates "sick" and not "resting".
 */
const NEGATION = /\b(no|not|never|without|didn'?t|wasn'?t|isn'?t|hasn'?t|nor)\b[^.!?,;]{0,15}$/i;

const negated = (text: string, index: number): boolean => NEGATION.test(text.slice(Math.max(0, index - 30), index));

/** Remarks with no observation content, which should classify as nothing. */
const BOILERPLATE = [
  /^(reported to (the )?hotline|see attached( photo)?|photo attached|no comment|n\/?a|nil|none)\.?$/i,
  /^lot \d+ dp \d+/i,
];

/** First un-negated match of any pattern, with the matched snippet. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!negated(text, m.index)) return m[0];
    }
  }
  return null;
}

const NOT_KOALA = [
  /\b(not|wasn'?t|isn'?t) (a |an )?koala\b/i,
  /\bturned out to be\b/i,
  /\bactually (a|an) (possum|wombat|cat|dog|glider|bird)\b/i,
  /\bmisidentif/i,
  /\bmistaken\b/i,
];

// "dead tree", "dead branch" and "dead end" are not a dead koala.
const DEAD = [
  /\b(dead(?! (tree|trees|branch|branches|end|wood|leaves|gum|timber|stag))|deceased|carcass|carcase|road ?kill|died|killed|euthani[sz]\w*|put down|found dead|remains)\b/i,
];

const UNWELL = [
  /\b(sick|ill|unwell|injur\w*|wound\w*|conjunctivitis|chlamydia|cystitis|blind|weak|emaciat\w*|very thin|thin|lethargic|dehydrat\w*|burn[st]?|burned|singed|scorched|mange|wet bottom|dirty bottom|diseas\w*|infect\w*|bleeding|broken|fractur\w*|limp\w*)\b/i,
];

const HEALTHY = [
  /\b(healthy|alert|active|awake|good condition|good nick|looks? (well|good|strong|fine)|looking (well|good|healthy)|feeding|eating|sleeping|resting|climbing|climbed|moving|moved|unharmed|unbothered|recovered|survived|safely|both fine|fine|in good health|fit and well)\b/i,
];

const EVENT_PATTERNS: Record<EventCode, RegExp[]> = {
  vehicle_strike: [
    /\b(hit by (a |the )?(car|vehicle|truck|bus|ute|motorbike|train)|car strike|vehicle strike|road ?kill|struck by (a |the )?(car|vehicle|truck)|run over|collision with (a |the )?(car|vehicle)|motor vehicle)\b/i,
  ],
  dog_attack: [
    /\b(dog attack\w*|attacked by (a |the |two |\d+ )?dogs?|dog bite\w*|bitten by (a |the )?dog|mauled|dogs? (got|killed|attacked|took|grabbed) (it|him|her|the koala))\b/i,
  ],
  disease: [
    /\b(chlamydia|conjunctivitis|cystitis|wet bottom|dirty bottom|diseas\w*|infect\w*|sick|ill|unwell|blind)\b/i,
  ],
  // A burnt patch of forest is fire, not an injury; singed or scorched fur is both.
  injury: [/\b(injur\w*|wound\w*|broken|fractur\w*|bleeding|singed|scorched|lacerat\w*|puncture\w*)\b/i],
  fire: [/\b(bush ?fires?|burnt|burned|fire[- ]affected|fire[- ]damaged|after the fires?|post[- ]fire|wildfire|scorched|singed|fireground)\b/i],
  rescue_or_care: [
    /\b(rescue\w*|wires|carer|rehab\w*|vet|vets|veterinar\w*|clinic|hospital|released|relocat\w*|taken into care|in care|translocat\w*|friends of the koala|koala hospital|wildlife carer|treatment|treated)\b/i,
  ],
  with_joey: [/\b(joey|joeys|back young|pouch young|with young|with (a |her )?baby|mother and (baby|young))\b/i],
};

export class KeywordClassifier implements TextClassifier {
  readonly key = "keyword" as const;
  readonly model = null;
  readonly promptVersion = null;
  readonly temperature = null;
  private requests = 0;

  async classify(items: TextItem[]): Promise<Map<string, TextLabel>> {
    const out = new Map<string, TextLabel>();
    for (const item of items) out.set(item.textHash, this.label(item.text));
    this.requests++;
    return out;
  }

  usage() {
    return { requests: this.requests, inputTokens: 0, outputTokens: 0 };
  }

  label(text: string): TextLabel {
    if (BOILERPLATE.some((p) => p.test(text.trim()))) {
      return { subject: "unclear", condition: "unknown", events: [], confidence: 0.6, evidence: "" };
    }

    const notKoala = firstMatch(text, NOT_KOALA);
    const dead = firstMatch(text, DEAD);
    const unwell = dead ? null : firstMatch(text, UNWELL);
    const healthy = dead || unwell ? null : firstMatch(text, HEALTHY);

    const events: EventCode[] = [];
    const evidence: string[] = [];
    for (const code of Object.keys(EVENT_PATTERNS) as EventCode[]) {
      const hit = firstMatch(text, EVENT_PATTERNS[code]);
      if (hit) {
        events.push(code);
        evidence.push(hit);
      }
    }

    // A harm event on an animal not stated to be dead implies it was alive and unwell.
    const harmed = events.some((e) => e === "vehicle_strike" || e === "dog_attack" || e === "injury" || e === "fire");
    const condition: Condition = dead
      ? "dead"
      : unwell || harmed
        ? "alive_unwell"
        : healthy
          ? "alive_healthy"
          : "unknown";

    const support = notKoala ?? dead ?? unwell ?? healthy ?? evidence[0] ?? "";
    return {
      subject: notKoala ? "not_koala" : "koala",
      condition,
      events,
      // Rules are either right or wrong; a fixed value keeps that honest rather than dressed up.
      confidence: support ? 0.6 : 0.3,
      evidence: support.slice(0, 80),
    };
  }
}
