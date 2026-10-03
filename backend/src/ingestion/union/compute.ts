import type { StoredRecord } from "../canonical/record.ts";
import { RECORD_TYPE_CODES, type RecordType } from "../canonical/recordType.ts";
import { dominantNamespace, namespaceOf } from "../analysis/compare.ts";
import type { RecordLabel } from "../analysis/text.ts";
import { CONDITION_CODES, EVENT_CODES } from "../text/taxonomy.ts";
import type { ClassifierKey, Condition, EventCode } from "../text/types.ts";

/**
 * The merged corpus: every source for one window as one set of distinct sightings.
 *
 * The portal reads this rather than the sources side by side. The same observation can
 * arrive through more than one source (an iNaturalist record fetched directly, and again
 * through ALA), so adding the sources together over-counts. Here each observation is
 * counted once.
 *
 * **The join** is `provenance.occurrenceId`, the same key `compare.ts` uses: an observation
 * held by two different sources under the same publisher id is one sighting. Duplicates
 * within a single source are left alone. They are the source's own business, and the
 * adapter has already removed exact repeats.
 *
 * **Which copy is kept** is the one from the source the observation originated at: the
 * source whose own identifiers make up essentially all of its corpus (iNaturalist for an
 * iNaturalist URL). The original carries the quality grade and the full text; the aggregator's
 * copy is a re-publication. Where the kept copy has no classifier label but another copy
 * does, the label is taken from the other copy. It describes the same observation.
 *
 * Output is counts only. Nothing per record leaves this function.
 */

/** Bump when the shape changes, so stored summaries from an older shape are recomputed. */
export const UNION_VERSION = 1;

const OBSCURED_BEYOND_METRES = 10_000;
/** A namespace has to cover nearly all of a corpus before that corpus counts as its origin. */
const ORIGIN_SHARE = 0.9;

export interface Tally {
  records: number;
  /** Location deliberately blurred beyond 10 km — a privacy measure, not an error. */
  obscured: number;
  /** Passed the canonical schema's structural checks. */
  valid: number;
  /** Records whose remarks a classifier judged to be about a koala: the denominator below. */
  remarksRead: number;
  byCondition: Record<Condition, number>;
  byEvent: Record<EventCode, number>;
}

export interface UnionMemberInput {
  harvestKey: string;
  source: string;
  runId: string;
  complete: boolean;
  records: StoredRecord[];
  /** Per-record labels from the chosen classifier, or null where it has not read this run. */
  labels: Map<string, RecordLabel> | null;
}

export interface UnionSource {
  source: string;
  harvestKey: string;
  runId: string;
  complete: boolean;
  /** Records this source holds. */
  records: number;
  /** Of those, the observations no other source holds. */
  onlyHere: number;
  /** Of those, the observations another source also holds. */
  shared: number;
}

export interface UnionDataset {
  dataResourceUid: string | null;
  dataResourceName: string;
  /** Distinct sightings this dataset supplied, after copies held elsewhere were removed. */
  records: number;
  byType: Partial<Record<RecordType, number>>;
}

export interface UnionCounts {
  classifier: ClassifierKey | null;
  /** Distinct sightings across every source. */
  distinct: number;
  /** Copies of an observation already counted from another source. */
  duplicatesRemoved: number;
  sources: UnionSource[];
  total: Tally;
  byType: Record<RecordType, Tally>;
  /** Largest first. */
  byDataset: UnionDataset[];
}

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

const emptyTally = (): Tally => ({
  records: 0,
  obscured: 0,
  valid: 0,
  remarksRead: 0,
  byCondition: zero(CONDITION_CODES),
  byEvent: zero(EVENT_CODES),
});

function add(t: Tally, s: StoredRecord, label: RecordLabel | null) {
  t.records++;
  if ((s.record.coordinateUncertaintyInMeters ?? 0) > OBSCURED_BEYOND_METRES) t.obscured++;
  if (s.record.isValid) t.valid++;
  if (label && label.subject === "koala") {
    t.remarksRead++;
    t.byCondition[label.condition]++;
    for (const e of label.events) t.byEvent[e]++;
  }
}

export function computeUnion(members: UnionMemberInput[], classifier: ClassifierKey | null): UnionCounts {
  // Which member, if any, is the origin of each identifier namespace.
  const originOf = new Map<string, number>();
  members.forEach((m, i) => {
    const { namespace, share } = dominantNamespace(m.records);
    if (namespace && share >= ORIGIN_SHARE && !originOf.has(namespace)) originOf.set(namespace, i);
  });

  // Every member holding each occurrence id, and each member's copy by id.
  const holders = new Map<string, Set<number>>();
  const copies = members.map(() => new Map<string, StoredRecord>());
  members.forEach((m, i) => {
    for (const s of m.records) {
      const key = s.record.provenance.occurrenceId;
      if (!key) continue;
      let set = holders.get(key);
      if (!set) holders.set(key, (set = new Set()));
      set.add(i);
      if (!copies[i]!.has(key)) copies[i]!.set(key, s);
    }
  });

  /** The member whose copy of a shared observation is kept. */
  const keeper = (key: string, held: Set<number>): number => {
    const origin = originOf.get(namespaceOf(key));
    if (origin !== undefined && held.has(origin)) return origin;
    return Math.min(...held);
  };

  /** A label for the observation from any member that has one, the kept copy's first. */
  const labelFor = (s: StoredRecord, memberIndex: number): RecordLabel | null => {
    const own = members[memberIndex]!.labels?.get(s.record.recordId);
    if (own) return own;
    const key = s.record.provenance.occurrenceId;
    if (!key) return null;
    for (const i of holders.get(key) ?? []) {
      if (i === memberIndex) continue;
      const copy = copies[i]!.get(key);
      const label = copy ? members[i]!.labels?.get(copy.record.recordId) : undefined;
      if (label) return label;
    }
    return null;
  };

  const total = emptyTally();
  const byType = Object.fromEntries(RECORD_TYPE_CODES.map((t) => [t, emptyTally()])) as Record<RecordType, Tally>;
  const datasets = new Map<string, UnionDataset>();
  let duplicatesRemoved = 0;

  const sources: UnionSource[] = members.map((m, i) => {
    let shared = 0;
    for (const s of m.records) {
      const key = s.record.provenance.occurrenceId;
      const held = key ? holders.get(key) : undefined;
      const isShared = held !== undefined && held.size > 1;
      if (isShared) shared++;
      if (isShared && keeper(key!, held) !== i) {
        duplicatesRemoved++;
        continue;
      }
      const label = labelFor(s, i);
      add(total, s, label);
      const type = s.record.recordType ?? "other";
      add(byType[type], s, label);
      const { dataResourceUid, dataResourceName } = s.record.provenance;
      const dKey = dataResourceUid ?? dataResourceName ?? "(unattributed)";
      const d = datasets.get(dKey) ?? { dataResourceUid, dataResourceName: dataResourceName ?? "(unattributed)", records: 0, byType: {} };
      d.records++;
      d.byType[type] = (d.byType[type] ?? 0) + 1;
      datasets.set(dKey, d);
    }
    return {
      source: m.source,
      harvestKey: m.harvestKey,
      runId: m.runId,
      complete: m.complete,
      records: m.records.length,
      onlyHere: m.records.length - shared,
      shared,
    };
  });

  return {
    classifier,
    distinct: total.records,
    duplicatesRemoved,
    sources,
    total,
    byType,
    byDataset: [...datasets.values()].sort((a, b) => b.records - a.records),
  };
}
