import { analyseCorpus, type CorpusAnalysis } from "./analysis/coverage.ts";
import { CANONICAL_SCHEMA, checkAgainstSchema } from "./canonical/schema.ts";
import { compareSources, type SourceComparison } from "./analysis/compare.ts";
import { INGESTION } from "./config/ingestion.ts";
import type { AdaptedRecord } from "./canonical/record.ts";
import { HARVESTS } from "./config/harvests.ts";
import { toPublicCoordinates } from "./privacy/coordinates.ts";
import {
  latestRunId,
  listRuns,
  readManifest,
  readPageBody,
  type SnapshotManifest,
} from "./snapshot/store.ts";
import { recordStore } from "./store/recordStore.ts";
import { getSource } from "./sources/registry.ts";

/**
 * Read layer over harvested runs, and the single place where ethics pillars 2 and 4 are
 * enforced on the way out. Nothing precise leaves the backend through any route that goes
 * through here.
 */

interface CachedRun {
  manifest: SnapshotManifest;
  records: AdaptedRecord[];
  analysis: CorpusAnalysis;
  byId: Map<string, AdaptedRecord>;
}

// The canonical file for a Stage 1 run is tens of megabytes once traces are included, so it is
// parsed once per process rather than per request. Runs are immutable, so the cache never
// needs invalidating — a new harvest is a new runId.
const cache = new Map<string, Promise<CachedRun>>();

async function loadRun(harvestKey: string, runId: string): Promise<CachedRun> {
  const key = `${harvestKey}/${runId}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = (async () => {
      const [manifest, records] = await Promise.all([
        readManifest(harvestKey, runId),
        recordStore.load(harvestKey, runId),
      ]);
      return {
        manifest,
        records,
        analysis: analyseCorpus(harvestKey, runId, records),
        byId: new Map(records.map((r) => [r.record.recordId, r])),
      };
    })();
    // Do not cache a failed load, or one bad read poisons the process.
    entry.catch(() => cache.delete(key));
    cache.set(key, entry);
  }
  return entry;
}

export async function resolveRunId(harvestKey: string, runId?: string): Promise<string> {
  const resolved = runId && runId !== "latest" ? runId : await latestRunId(harvestKey);
  if (!resolved) throw new Error(`no snapshots for harvest "${harvestKey}"`);
  return resolved;
}

/** Every configured harvest, with the runs it has produced. */
export async function listHarvests() {
  return Promise.all(
    Object.values(HARVESTS).map(async (harvest) => {
      const runs = await listRuns(harvest.key);
      const summaries = await Promise.all(
        runs.map(async (runId) => {
          const m = await readManifest(harvest.key, runId);
          return {
            runId,
            startedAt: m.startedAt,
            expectedRecords: m.expectedRecords,
            retrievedRecords: m.retrievedRecords,
            complete: m.complete,
            corpusHash: m.corpusHash,
            warnings: m.warnings.length,
          };
        }),
      );
      return { ...harvest, runs: summaries };
    }),
  );
}

export async function getManifest(harvestKey: string, runId: string) {
  return (await loadRun(harvestKey, runId)).manifest;
}

export async function getAnalysis(harvestKey: string, runId: string) {
  return (await loadRun(harvestKey, runId)).analysis;
}

/**
 * Apply the outbound protections to a canonical record.
 *
 * Coordinates are reduced to ~1.1km (ethics pillar 4) and the precise pair never crosses this
 * boundary. The observer pseudonym is already irreversible by the time it is stored, so it
 * passes through as-is.
 */
function toPublicRecord(record: AdaptedRecord["record"]) {
  const coords = toPublicCoordinates(record.decimalLatitude, record.decimalLongitude);

  // Ethics pillar 3, and a licensing obligation rather than a preference. A contributor who
  // reserved rights over their words permitted this platform to read them, not to republish
  // them — so the text stops here. The record is still counted, measured and reasoned about;
  // only the words are withheld, and the withholding is stated rather than silent.
  const textWithheld = !record.provenance.contentRedistributable;

  return {
    ...record,
    ...coords,
    occurrenceRemarks: textWithheld ? null : record.occurrenceRemarks,
    eventRemarks: textWithheld ? null : record.eventRemarks,
    textWithheld,
    textWithheldReason: textWithheld
      ? `licence "${record.provenance.license ?? "none"}" does not permit redistribution — the record is counted and analysed, but the contributor's text is not served`
      : null,
  };
}

export interface RecordQuery {
  limit: number;
  offset: number;
  /** Substring match across free text, locality and identifiers. */
  search?: string;
  dataResourceUid?: string;
  /** Only records carrying substantive free text. */
  withText?: boolean;
  /** Only records that failed a basic check. */
  invalidOnly?: boolean;
}

export async function listRecords(harvestKey: string, runId: string, query: RecordQuery) {
  const run = await loadRun(harvestKey, runId);
  let items = run.records;

  if (query.dataResourceUid) {
    items = items.filter((r) => r.record.provenance.dataResourceUid === query.dataResourceUid);
  }
  if (query.invalidOnly) {
    items = items.filter((r) => !r.record.isValid || r.trace.validationIssues.length > 0);
  }
  if (query.withText) {
    items = items.filter((r) => (r.record.occurrenceRemarks ?? "").trim().length >= 20);
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    items = items.filter((r) => {
      const rec = r.record;
      return [
        rec.recordId,
        rec.occurrenceRemarks,
        rec.eventRemarks,
        rec.locality,
        rec.provenance.dataResourceName,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }

  return {
    total: items.length,
    corpusTotal: run.records.length,
    offset: query.offset,
    limit: query.limit,
    // Each row is the whole public record, so the grid can show every column the schema
    // declares rather than a hand-picked subset. Structural problems travel as a sparse list:
    // "empty" is visible in the grid as NULL and "ok" is the default, so only the two states
    // that need colouring are sent.
    items: items.slice(query.offset, query.offset + query.limit).map((r) => ({
      ...toPublicRecord(r.record),
      issueCount: r.trace.validationIssues.length,
      unmappedCount: r.trace.unmappedSourceFields.length,
      schemaProblems: checkAgainstSchema(r.record)
        .filter((c) => c.status === "missing_required" || c.status === "type_mismatch")
        .map((c) => ({ path: c.path, status: c.status })),
    })),
  };
}

/**
 * Fields in the raw source record that must not be served verbatim. The record inspector
 * exists to show raw beside mapped, so hiding these silently would make it lie; instead the
 * value is replaced with a marker the UI renders as a redaction, and the reason is given.
 */
const REDACTED_RAW_FIELDS: Record<string, string> = {
  decimalLatitude: "ethics pillar 4 — precise coordinates are never served; see the fuzzed value",
  decimalLongitude: "ethics pillar 4 — precise coordinates are never served; see the fuzzed value",
  recordedBy: "ethics pillar 2 — observer identifier; see recordedByPseudonym",
  collectors: "ethics pillar 2 — observer identifier; see recordedByPseudonym",
  collector: "ethics pillar 2 — observer identifier; see recordedByPseudonym",
  latLong: "ethics pillar 4 — precise coordinates are never served",
  point0001: "ethics pillar 4 — precise coordinates are never served",
  point00001: "ethics pillar 4 — precise coordinates are never served",
  // iNaturalist. Its coordinates are a "lat,lng" string plus a GeoJSON point, and the
  // private_* variants are what an authorised viewer would see unobscured.
  location: "ethics pillar 4 — precise coordinates are never served; see the fuzzed value",
  geojson: "ethics pillar 4 — precise coordinates are never served; see the fuzzed value",
  private_location: "ethics pillar 4 — precise coordinates are never served",
  private_geojson: "ethics pillar 4 — precise coordinates are never served",
  private_place_guess: "ethics pillar 4 — precise locality is never served",
  user: "ethics pillar 2 — observer identity (login, real name, id); see recordedByPseudonym",
  reviewed_by: "ethics pillar 2 — reviewer user ids",
  faves: "ethics pillar 2 — favouriting user ids",
  votes: "ethics pillar 2 — voting user ids",
};

/**
 * Keys that identify a person wherever they occur *inside* a raw record. iNaturalist nests a
 * full user object (login, real name, id) under every identification, comment and vote, so a
 * top-level list cannot reach them, and redacting `identifications` wholesale would hide the
 * identification disagreements the LLM arm exists to read. The nested user is replaced and
 * the rest of the structure is kept.
 */
const NESTED_IDENTITY_KEYS = new Set([
  "user",
  "user_id",
  "user_login",
  "user_name",
  // Photo attribution strings carry the photographer's real name ("(c) J. Smith, some rights
  // reserved (CC BY-NC)"). The licence itself is also on `license_code`, so nothing is lost.
  "attribution",
]);

/**
 * iNaturalist comments and identification remarks address people as `@login`. A mention at
 * the start of a word is masked; the character class before the `@` keeps email addresses and
 * mid-word `@` out of scope.
 */
const MENTION = /(^|[^\w.])@[A-Za-z0-9_]+/g;

/** Replace nested identity keys and mentions throughout a value, returning the copy and how many were hit. */
function scrubNestedIdentity(value: unknown): { value: unknown; hits: number } {
  if (typeof value === "string") {
    let hits = 0;
    const out = value.replace(MENTION, (_m, before: string) => {
      hits++;
      return `${before}@[redacted]`;
    });
    return { value: out, hits };
  }
  if (Array.isArray(value)) {
    let hits = 0;
    const out = value.map((item) => {
      const r = scrubNestedIdentity(item);
      hits += r.hits;
      return r.value;
    });
    return { value: out, hits };
  }
  if (value !== null && typeof value === "object") {
    let hits = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NESTED_IDENTITY_KEYS.has(k)) {
        out[k] = "[redacted]";
        hits++;
      } else {
        const r = scrubNestedIdentity(v);
        hits += r.hits;
        out[k] = r.value;
      }
    }
    return { value: out, hits };
  }
  return { value, hits: 0 };
}

/**
 * Find the harvests covering the same species, region and window through a different source.
 * That triple is what makes two corpora comparable; anything else would be comparing
 * different questions and calling the difference a finding.
 */
function siblingHarvests(harvestKey: string) {
  const self = HARVESTS[harvestKey];
  if (!self) return [];
  return Object.values(HARVESTS).filter(
    (h) =>
      h.key !== self.key &&
      h.speciesKey === self.speciesKey &&
      h.regionKey === self.regionKey &&
      h.startDate === self.startDate &&
      h.endDate === self.endDate,
  );
}

/**
 * Compare this run against the newest run of every comparable harvest from another source.
 * Orientation and namespace scoping are decided inside `compareSources`.
 */
export async function getComparisons(
  harvestKey: string,
  runId: string,
): Promise<SourceComparison[]> {
  const self = await loadRun(harvestKey, runId);
  const results: SourceComparison[] = [];

  for (const sibling of siblingHarvests(harvestKey)) {
    const siblingRun = await latestRunId(sibling.key);
    if (!siblingRun) continue;

    let other;
    try {
      other = await loadRun(sibling.key, siblingRun);
    } catch {
      // A harvested but not-yet-adapted sibling is not an error worth failing the page over.
      continue;
    }

    results.push(
      compareSources(
        { harvestKey, runId, records: self.records },
        { harvestKey: sibling.key, runId: siblingRun, records: other.records },
      ),
    );
  }

  return results;
}

/**
 * Every source fetched for the same species, region and window: this run plus the newest run
 * of each sibling harvest, with the pairwise comparisons. The cross-source pages read this
 * rather than the selected run, so they say the same thing whichever sibling is selected.
 */
export async function getFamily(harvestKey: string, runId: string) {
  const self = HARVESTS[harvestKey];
  if (!self) throw new Error(`unknown harvest "${harvestKey}"`);

  const runs: { harvestKey: string; runId: string; run: CachedRun }[] = [
    { harvestKey, runId, run: await loadRun(harvestKey, runId) },
  ];
  for (const sibling of siblingHarvests(harvestKey)) {
    const siblingRun = await latestRunId(sibling.key);
    if (!siblingRun) continue;
    try {
      runs.push({ harvestKey: sibling.key, runId: siblingRun, run: await loadRun(sibling.key, siblingRun) });
    } catch {
      // Harvested but not yet adapted: not an error worth failing the page over.
      continue;
    }
  }

  // Registry order, so the pages list sources the same way regardless of which is selected.
  const order = Object.keys(HARVESTS);
  runs.sort((a, b) => order.indexOf(a.harvestKey) - order.indexOf(b.harvestKey));

  return {
    speciesKey: self.speciesKey,
    regionKey: self.regionKey,
    startDate: self.startDate,
    endDate: self.endDate,
    members: runs.map((r) => ({
      harvestKey: r.harvestKey,
      runId: r.runId,
      source: r.run.manifest.source,
      manifest: r.run.manifest,
      analysis: r.run.analysis,
    })),
    comparisons: await getComparisons(harvestKey, runId),
  };
}

/** The frozen API calls that make up a run, grouped for navigation. */
export async function listPages(harvestKey: string, runId: string) {
  const { manifest } = await loadRun(harvestKey, runId);
  return {
    serveRawResponses: INGESTION.serveRawResponses,
    // Where the record array sits inside a page body, so the raw view can offer a per-record
    // scope for any source rather than assuming ALA's shape.
    recordsKey: getSource(manifest.source).recordsKey,
    query: manifest.query,
    slices: manifest.slices.map((slice) => ({
      sliceKey: slice.sliceKey,
      filters: slice.filters,
      expectedRecords: slice.expectedRecords,
      retrievedRecords: slice.retrievedRecords,
      pages: manifest.pages
        .filter((p) => p.sliceKey === slice.sliceKey)
        .sort((a, b) => a.startIndex - b.startIndex),
    })),
  };
}

/**
 * One frozen response, exactly as the source returned it.
 *
 * This is the only route that does not apply the outbound protections, because a redacted
 * "raw response" would misrepresent what the source sent — which is the one thing this view
 * exists to show. It is gated on `INGESTION_SERVE_RAW` accordingly.
 */
export async function getRawPage(harvestKey: string, runId: string, file: string) {
  if (!INGESTION.serveRawResponses) return null;
  const { manifest } = await loadRun(harvestKey, runId);
  const page = manifest.pages.find((p) => p.file === file);
  if (!page) return null;
  return { page, body: await readPageBody(harvestKey, runId, file) };
}

/** The schema itself, plus how the current corpus conforms to it. */
export async function getSchema(harvestKey: string, runId: string) {
  const run = await loadRun(harvestKey, runId);
  const total = run.records.length;

  // Conformance is summarised across the whole corpus so the schema page can show, per field,
  // how often the shape actually holds rather than only how it is declared.
  const tally = new Map<string, { ok: number; empty: number; missing_required: number; type_mismatch: number }>();
  for (const { record } of run.records) {
    for (const check of checkAgainstSchema(record)) {
      const entry = tally.get(check.path) ?? { ok: 0, empty: 0, missing_required: 0, type_mismatch: 0 };
      entry[check.status]++;
      tally.set(check.path, entry);
    }
  }

  return {
    totalRecords: total,
    groups: CANONICAL_SCHEMA.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({
        ...field,
        conformance: tally.get(field.path) ?? { ok: 0, empty: 0, missing_required: 0, type_mismatch: 0 },
      })),
    })),
  };
}

/** The record, its trace, and the raw source record it was built from. */
export async function getRecordDetail(harvestKey: string, runId: string, recordId: string) {
  const run = await loadRun(harvestKey, runId);
  const adapted = run.byId.get(recordId);
  if (!adapted) return null;

  // Recover the raw record from the frozen page, so the inspector shows the actual source
  // bytes rather than a reconstruction from the canonical form.
  const source = getSource(run.manifest.source);
  const body = await readPageBody(harvestKey, runId, adapted.record.provenance.snapshotPage);
  const page = JSON.parse(body) as Record<string, unknown>;
  const rawRecords = page[source.recordsKey];
  const wanted = adapted.record.provenance.sourceRecordId;
  const rawRecord = Array.isArray(rawRecords)
    ? ((rawRecords as Record<string, unknown>[]).find(
        (o) => String(o[source.recordIdField]) === wanted,
      ) ?? null)
    : null;

  const redactions: { field: string; reason: string }[] = [];
  const publicRaw: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(rawRecord ?? {})) {
    const reason = REDACTED_RAW_FIELDS[field];
    if (reason) {
      publicRaw[field] = "[redacted]";
      redactions.push({ field, reason });
      continue;
    }
    const scrubbed = scrubNestedIdentity(value);
    publicRaw[field] = scrubbed.value;
    if (scrubbed.hits > 0) {
      redactions.push({
        field,
        reason: `ethics pillar 2 — ${scrubbed.hits} nested user identit${scrubbed.hits === 1 ? "y" : "ies"} replaced; structure kept`,
      });
    }
  }

  // The trace carries raw values too, and they are subject to the same rule.
  const publicTrace = {
    ...adapted.trace,
    fields: adapted.trace.fields.map((f) => {
      const reason = f.sourceFields.map((s) => REDACTED_RAW_FIELDS[s]).find(Boolean);
      return reason ? { ...f, rawValue: "[redacted]", redactionReason: reason } : f;
    }),
  };

  // Index the trace by canonical field so the schema view can attach "how did this value get
  // here" to each field without the caller re-joining two lists.
  const traceByField = new Map(publicTrace.fields.map((f) => [f.canonicalField, f]));

  return {
    record: toPublicRecord(adapted.record),
    trace: publicTrace,
    schemaChecks: checkAgainstSchema(adapted.record).map((check) => ({
      ...check,
      // Coordinates are fuzzed on the way out, so echo the served value rather than the stored
      // one — otherwise the schema page would display a precise coordinate the API withheld.
      value:
        check.path === "decimalLatitude" || check.path === "decimalLongitude"
          ? (toPublicRecord(adapted.record) as Record<string, unknown>)[check.path]
          : check.value,
      provenance: traceByField.get(check.path) ?? null,
    })),
    raw: publicRaw,
    redactions,
    snapshotPage: adapted.record.provenance.snapshotPage,
  };
}
