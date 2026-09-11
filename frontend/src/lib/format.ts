/** Small shared formatters. Kept in one place so the three views read consistently. */

export const pct = (value: number, dp = 1): string => `${(value * 100).toFixed(dp)}%`;

export const num = (value: number): string => value.toLocaleString("en-AU");

export const shortHash = (hash: string, length = 12): string => hash.slice(0, length);

export const bytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const dateOnly = (iso: string | null): string =>
  iso ? iso.slice(0, 10) : "—";

/** Display name for a source registry key, for prose. Tables keep the key itself. */
const SOURCE_LABELS: Record<string, string> = {
  ala: "ALA",
  inaturalist: "iNaturalist",
  gbif: "GBIF",
};
export const sourceLabel = (key: string): string => SOURCE_LABELS[key] ?? key;

/** Compact preview of an arbitrary JSON value for a table cell. */
export const preview = (value: unknown, max = 70): string => {
  if (value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === null || text === undefined) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
