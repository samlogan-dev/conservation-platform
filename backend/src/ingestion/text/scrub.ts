/**
 * Ethics pillar 2, applied at the boundary before any text reaches a model: strip the
 * identifiers a remark can carry. Observer identity is already a pseudonym by the time a
 * record is stored; this handles what contributors write *into* the text — an email, a phone
 * number, a link, a handle.
 *
 * Names are not removed. There is no reliable way to tell a person's name from a place name
 * in "Seen near Smiths Lake with Mrs Jones", and false removals would destroy locality text
 * the classifier needs. That limitation is stated rather than hidden.
 */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
/** Australian mobile and landline shapes, with or without spaces, plus +61 forms. */
const PHONE = /(?:\+61\s?|\b0)[2-9](?:[\s-]?\d){8}\b/g;
/** A handle at the start of a word; the class before the @ keeps emails out of scope. */
const MENTION = /(^|[^\w.])@[A-Za-z0-9_]+/g;

/** Longer than this is not a sighting remark; it is a pasted report, and it is truncated. */
const MAX_CHARS = 1_500;

export interface ScrubResult {
  text: string;
  redactions: number;
}

export function scrubForModel(input: string): ScrubResult {
  let redactions = 0;
  const count = (s: string, re: RegExp, replacement: string) =>
    s.replace(re, (...m) => {
      redactions++;
      // MENTION keeps its leading character.
      return typeof m[1] === "string" && re === MENTION ? `${m[1]}${replacement}` : replacement;
    });

  let text = input;
  text = count(text, EMAIL, "[email]");
  text = count(text, URL, "[link]");
  text = count(text, PHONE, "[phone]");
  text = count(text, MENTION, "[user]");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}…`;

  return { text, redactions };
}
