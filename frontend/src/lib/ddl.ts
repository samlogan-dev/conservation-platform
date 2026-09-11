import type { SchemaResponse } from "@/apis/corpusTypes";
import { pct } from "@/lib/format";

/**
 * The tables as Postgres would declare them — the "Definition" behind each grid.
 *
 * The store today is JSON on disk with exactly these fields, so nothing here is executed; it
 * is the schema rendered in the vocabulary a database reader expects, generated from the same
 * declaration the checks run against so the two cannot drift.
 */

const PG_TYPES: Record<string, string> = {
  string: "text",
  integer: "integer",
  number: "double precision",
  boolean: "boolean",
  iso8601: "timestamptz",
  latitude: "double precision",
  longitude: "double precision",
  "string[]": "text[]",
};

export const snakeCase = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Word-wrap a comment so a long schema description does not run off the viewer. */
function comment(text: string, indent = "  ", width = 84): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if ((current + " " + word).trim().length > width) {
      lines.push(`${indent}-- ${current.trim()}`);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(`${indent}-- ${current.trim()}`);
  return lines;
}

const column = (name: string, type: string, constraints: string[] = []): string =>
  `  ${name.padEnd(34)} ${type.padEnd(18)} ${constraints.join(" ")}`.trimEnd() + ",";

export function sightingsDdl(schema: SchemaResponse): string[] {
  const lines = [
    "-- sightings — one row per canonical record. Every source lands here in the same shape;",
    "-- that is what lets records from different sources be compared at all.",
    `-- ${schema.totalRecords.toLocaleString("en-AU")} rows in this run.`,
    "--",
    "-- The store today is JSON on disk with exactly these fields. This is the Postgres form it",
    "-- maps to: the canonical (Darwin Core) field names in snake_case, the declared types, and",
    "-- 'not null' wherever the schema marks a field required.",
    "create table sightings (",
  ];

  for (const group of schema.groups) {
    lines.push(`  -- ${group.label}`);
    lines.push(...comment(group.description));
    for (const field of group.fields) {
      const name = snakeCase(field.path.split(".").pop()!);
      const constraints: string[] = [];
      if (field.required) constraints.push("not null");
      if (field.type === "latitude") constraints.push(`check (${name} between -90 and 90)`);
      if (field.type === "longitude") constraints.push(`check (${name} between -180 and 180)`);
      lines.push(column(name, PG_TYPES[field.type] ?? "text", constraints));
    }
    lines.push("");
  }

  lines.push(
    "  primary key (record_id),",
    "  foreign key (harvest_id) references harvest_runs (id),",
    "  foreign key (harvest_id, snapshot_page) references snapshot_pages (harvest_id, file)",
    ");",
  );
  return lines;
}

/**
 * The menu of fields the source supplies that the schema leaves out, as a trailing comment
 * block. It sits with the definition because it is a schema decision: the difference between
 * a considered omission and an oversight is that the omission is written down.
 */
export function excludedFieldsComment(
  source: string,
  fields: { field: string; share: number; reason: string }[],
): string[] {
  if (fields.length === 0) return [];
  return [
    "",
    `-- Available from ${source}, not kept. Restoring one is an edit to the adapter plus a`,
    "-- re-adapt of the frozen snapshot: about a second, and no new API traffic.",
    "--",
    `--   ${"field".padEnd(34)} ${"populated".padStart(9)}   why not kept`,
    ...fields.map(
      (f) => `--   ${f.field.padEnd(34)} ${pct(f.share, 0).padStart(9)}   ${f.reason}`,
    ),
  ];
}

export function harvestRunsDdl(): string[] {
  return [
    "-- harvest_runs — one row per harvest run: a named query window, fetched once and frozen.",
    "-- sightings.harvest_id points here. The run is the unit of reproducibility.",
    "create table harvest_runs (",
    column("id", "text", ["not null"]) + "   -- \"<harvest key>/<run id>\"",
    column("harvest_key", "text", ["not null"]),
    column("source", "text", ["not null"]) + "   -- registry key: ala, inaturalist",
    column("species_key", "text", ["not null"]),
    column("region_key", "text", ["not null"]),
    column("start_date", "date", ["not null"]),
    column("end_date", "date", ["not null"]),
    column("started_at", "timestamptz", ["not null"]),
    column("expected_records", "integer", ["not null"]) + "   -- what the source said it held",
    column("retrieved_records", "integer", ["not null"]) + "   -- what was actually fetched",
    column("complete", "boolean", ["not null"]) + "   -- the two agree",
    column("corpus_hash", "text", ["not null"]) + "   -- sha256 over the page hashes, order-independent",
    column("warnings", "integer", ["not null"]),
    "  primary key (id)",
    ");",
  ];
}

export function textClassificationsDdl(): string[] {
  return [
    "-- text_classifications — one row per labelled remark: a claim about a sighting, made by",
    "-- a named classifier under a versioned prompt and taxonomy. Separate from sightings",
    "-- because it is regenerable, can be wrong, and two classifiers can disagree about the",
    "-- same record. The evidence quote is withheld wherever the text itself is.",
    "create table text_classifications (",
    column("record_id", "text", ["not null", "references sightings (record_id)"]),
    column("field", "text", ["not null"]) + "   -- occurrenceRemarks | eventRemarks",
    column("text_hash", "text", ["not null"]) + "   -- sha256 of the scrubbed text; identical remarks share a label",
    column("classifier", "text", ["not null"]) + "   -- keyword | llm",
    column("model", "text") + "   -- model id, for llm rows",
    column("prompt_version", "text"),
    column("taxonomy_version", "text", ["not null"]),
    column("subject", "text", ["not null"]) + "   -- koala | not_koala | unclear",
    column("condition", "text", ["not null"]) + "   -- alive_healthy | alive_unwell | dead | unknown",
    column("events", "text[]", ["not null"]) + "   -- vehicle_strike, dog_attack, disease, injury, fire, rescue_or_care, with_joey",
    column("confidence", "double precision", ["not null"]),
    column("evidence", "text") + "   -- short quote supporting the label",
    "  primary key (record_id, field, classifier)",
    ");",
  ];
}

export function snapshotPagesDdl(): string[] {
  return [
    "-- snapshot_pages — one row per frozen API response, the bytes page 1 shows.",
    "-- sightings.snapshot_page points here; a page name is only unique within its run.",
    "create table snapshot_pages (",
    column("harvest_id", "text", ["not null", "references harvest_runs (id)"]),
    column("file", "text", ["not null"]),
    column("slice_key", "text", ["not null"]) + "   -- the date slice the window was partitioned into",
    column("start_index", "integer", ["not null"]),
    column("page_size", "integer", ["not null"]),
    column("url", "text", ["not null"]) + "   -- the exact request",
    column("status", "integer", ["not null"]) + "   -- HTTP status",
    column("record_count", "integer", ["not null"]),
    column("bytes", "integer", ["not null"]),
    column("content_hash", "text", ["not null"]) + "   -- sha256 of the bytes on disk",
    column("fetched_at", "timestamptz", ["not null"]),
    column("duration_ms", "integer", ["not null"]),
    column("attempts", "integer", ["not null"]) + "   -- >1 means a retry after 429/5xx",
    "  primary key (harvest_id, file)",
    ");",
  ];
}
