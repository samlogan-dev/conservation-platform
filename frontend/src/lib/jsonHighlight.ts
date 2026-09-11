/**
 * Minimal read-only JSON syntax highlighter.
 *
 * Written rather than pulled in because the requirement is a code-editor *look* on content
 * nobody edits — CodeMirror or Monaco would add hundreds of kilobytes to do nothing but colour
 * text.
 *
 * It is applied one line at a time, to the lines currently on screen, not to a whole document.
 * A pretty-printed iNaturalist page is close to a million lines, and highlighting all of them
 * up front would cost seconds for text nobody scrolls to. Per-line is safe because
 * `JSON.stringify(value, null, 2)` never breaks a string token across lines — newlines inside
 * strings stay escaped — so every line tokenises on its own.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * Strings (with escape sequences), optionally followed by a colon to mark them as keys; then
 * the bare literals; then numbers.
 *
 * Tokenising runs on the *unescaped* source and escapes each fragment as it is emitted.
 * Escaping first would rewrite every `"` to `&quot;`, leaving the string pattern unable to
 * match — at which point the number pattern happily colours the digits inside a UUID.
 */
const TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(json: string): string {
  let out = "";
  let lastIndex = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN.exec(json)) !== null) {
    const [full, str, colon, literal, numeric] = match;

    // Anything between the previous token and this one is plain punctuation or whitespace.
    out += escapeHtml(json.slice(lastIndex, match.index));

    if (str !== undefined) {
      const cls = colon === undefined ? "tok-str" : "tok-key";
      out += `<span class="${cls}">${escapeHtml(str)}</span>`;
      if (colon !== undefined) out += escapeHtml(colon);
    } else if (literal !== undefined) {
      out += `<span class="tok-lit">${escapeHtml(literal)}</span>`;
    } else if (numeric !== undefined) {
      out += `<span class="tok-num">${escapeHtml(numeric)}</span>`;
    }

    lastIndex = match.index + full.length;
  }

  return out + escapeHtml(json.slice(lastIndex));
}

/** Pretty-print to plain lines. Highlight each with `highlightJson` when it is rendered. */
export function prettyLines(value: unknown): string[] {
  return JSON.stringify(value, null, 2).split("\n");
}
