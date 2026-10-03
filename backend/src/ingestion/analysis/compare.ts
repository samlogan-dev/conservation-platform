import type { CanonicalRecord } from "../canonical/record.ts";
import { bandText } from "./coverage.ts";

/** Anything carrying a canonical record; the comparison never needs the trace. */
type AdaptedRecord = { record: CanonicalRecord };

/**
 * Cross-source comparison.
 *
 * The measurement Stage 2 exists for: take the same species, region and window from two
 * sources and ask what the aggregator's copy is missing relative to the primary source's.
 *
 * The join is `provenance.occurrenceId`. ALA republishes iNaturalist records under the
 * canonical observation URL, and the iNaturalist adapter constructs the same string, so the
 * same observation carries the same key on both sides. Nothing else in either record would
 * join reliably — coordinates are obscured on one side, dates are truncated, and neither
 * source's internal id means anything to the other.
 *
 * **The comparison must be scoped to a shared identifier namespace, and getting this wrong
 * produces a confidently meaningless number.** An aggregator's corpus is a union of many
 * contributors: of ALA's 2,865 koala records only 263 came from iNaturalist, the rest from
 * BioNet, museums and local programs. Comparing the two corpora wholesale reports 2,512
 * records "missing" from iNaturalist that were never iNaturalist observations in the first
 * place. So both sides are filtered to the primary source's own identifier namespace before
 * anything is counted, and the primary is identified as the corpus where that namespace
 * accounts for essentially every record.
 */

/** The stable prefix an identifier scheme shares — everything up to the final separator. */
export function namespaceOf(occurrenceId: string): string {
  const cut = Math.max(occurrenceId.lastIndexOf("/"), occurrenceId.lastIndexOf(":"));
  return cut > 0 ? occurrenceId.slice(0, cut) : occurrenceId;
}

/** The identifier namespace covering the largest share of a corpus, and that share. */
export function dominantNamespace(records: AdaptedRecord[]): { namespace: string; share: number } {
  const tally = new Map<string, number>();
  let withKey = 0;
  for (const r of records) {
    const key = r.record.provenance.occurrenceId;
    if (!key) continue;
    withKey++;
    const ns = namespaceOf(key);
    tally.set(ns, (tally.get(ns) ?? 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || withKey === 0) return { namespace: "", share: 0 };
  return { namespace: top[0], share: top[1] / withKey };
}

export interface SourceSide {
  source: string;
  harvestKey: string;
  runId: string;
  /** Records in the whole corpus, before it was restricted to the shared namespace. */
  corpusRecords: number;
  /** Records inside the shared namespace — the only ones the join can see. */
  totalRecords: number;
  /** Records carrying a join key at all. Anything without one cannot be matched either way. */
  joinable: number;
  substantiveText: number;
}

export interface LicenceBreakdown {
  license: string;
  records: number;
  share: number;
  redistributable: boolean;
}

export interface SourceComparison {
  /** The identifier namespace both sides were restricted to before counting. */
  namespace: string;
  left: SourceSide;
  right: SourceSide;
  /** Observations present in both corpora. */
  matched: number;
  /** In the left corpus only — for a primary-vs-aggregator pair, what the aggregator never got. */
  onlyLeft: number;
  onlyRight: number;
  /** Share of the left corpus the right corpus actually carries. */
  coverageOfLeft: number;
  /**
   * Substantive free text among the *matched* records only, counted on each side.
   *
   * This separates two losses that the headline coverage figure conflates: records the
   * aggregator never received at all, and content stripped from the records it did receive.
   * Only the second is visible here, and only by comparing the same observations to themselves.
   */
  matchedTextLeft: number;
  matchedTextRight: number;
  /**
   * Matched records whose coordinate uncertainty exceeds the obscuring threshold, per side.
   * iNaturalist obscures threatened-species coordinates at the source; if the aggregator's
   * copy of the same observation is not flagged the same way, the privacy signal was lost in
   * transit — which matters for any rule that would treat obscured points as errors.
   */
  matchedObscuredLeft: number;
  matchedObscuredRight: number;
  /**
   * Licences of the left-only records. For iNaturalist this is the explanation rather than a
   * curiosity: the platform only exports openly licensed observations to aggregators, so an
   * All Rights Reserved record is structurally invisible downstream.
   */
  onlyLeftByLicence: LicenceBreakdown[];
  /** Left-only records that *are* openly licensed, and so are not explained by licensing. */
  unexplainedShortfall: number;
}

const substantive = (records: AdaptedRecord[]): number =>
  records.filter((r) => bandText(r.record.occurrenceRemarks) === "substantive").length;

/** Same threshold as the per-resource analysis: beyond 10 km is deliberate obscuring, not GPS error. */
const OBSCURED_BEYOND_METRES = 10_000;
const obscured = (records: AdaptedRecord[]): number =>
  records.filter((r) => (r.record.coordinateUncertaintyInMeters ?? 0) > OBSCURED_BEYOND_METRES)
    .length;

const side = (
  harvestKey: string,
  runId: string,
  records: AdaptedRecord[],
  corpusRecords: number,
): SourceSide => ({
  source: records[0]?.record.provenance.source ?? "unknown",
  harvestKey,
  runId,
  corpusRecords,
  totalRecords: records.length,
  joinable: records.filter((r) => r.record.provenance.occurrenceId).length,
  substantiveText: substantive(records),
});

export function compareSources(
  a: { harvestKey: string; runId: string; records: AdaptedRecord[] },
  b: { harvestKey: string; runId: string; records: AdaptedRecord[] },
): SourceComparison {
  // The primary source is the one whose corpus is essentially all one namespace; an aggregator
  // spans many. Orientation follows from that rather than from corpus size, which would pick
  // the aggregator simply for carrying more contributors.
  const nsA = dominantNamespace(a.records);
  const nsB = dominantNamespace(b.records);
  const [left, right, ns] =
    nsA.share >= nsB.share ? [a, b, nsA.namespace] : [b, a, nsB.namespace];

  const inNamespace = (r: AdaptedRecord) => {
    const key = r.record.provenance.occurrenceId;
    return key !== null && namespaceOf(key) === ns;
  };

  const leftScoped = left.records.filter(inNamespace);
  const rightScoped = right.records.filter(inNamespace);

  const leftKeys = new Map<string, AdaptedRecord>();
  for (const r of leftScoped) {
    leftKeys.set(r.record.provenance.occurrenceId!, r);
  }
  const rightKeys = new Set(rightScoped.map((r) => r.record.provenance.occurrenceId!));

  const matchedKeys = [...leftKeys.keys()].filter((k) => rightKeys.has(k));
  const matchedSet = new Set(matchedKeys);
  const leftMatched = leftScoped.filter((r) => matchedSet.has(r.record.provenance.occurrenceId!));
  const rightMatched = rightScoped.filter((r) => matchedSet.has(r.record.provenance.occurrenceId!));
  const matchedTextLeft = substantive(leftMatched);
  const matchedTextRight = substantive(rightMatched);
  const onlyLeftRecords = [...leftKeys.entries()]
    .filter(([k]) => !rightKeys.has(k))
    .map(([, r]) => r);

  // Licence tally over the left-only records — the candidate explanation for the gap.
  const licenceMap = new Map<string, { records: number; redistributable: boolean }>();
  for (const r of onlyLeftRecords) {
    const licence = r.record.provenance.license ?? "none / all rights reserved";
    const entry = licenceMap.get(licence) ?? {
      records: 0,
      redistributable: r.record.provenance.contentRedistributable,
    };
    entry.records++;
    licenceMap.set(licence, entry);
  }

  const onlyLeftByLicence: LicenceBreakdown[] = [...licenceMap.entries()]
    .map(([license, v]) => ({
      license,
      records: v.records,
      share: onlyLeftRecords.length === 0 ? 0 : v.records / onlyLeftRecords.length,
      redistributable: v.redistributable,
    }))
    .sort((a, b) => b.records - a.records);

  return {
    namespace: ns,
    left: side(left.harvestKey, left.runId, leftScoped, left.records.length),
    right: side(right.harvestKey, right.runId, rightScoped, right.records.length),
    matched: matchedKeys.length,
    onlyLeft: onlyLeftRecords.length,
    onlyRight: rightKeys.size - matchedKeys.length,
    coverageOfLeft: leftKeys.size === 0 ? 0 : matchedKeys.length / leftKeys.size,
    matchedTextLeft,
    matchedTextRight,
    matchedObscuredLeft: obscured(leftMatched),
    matchedObscuredRight: obscured(rightMatched),
    onlyLeftByLicence,
    // Openly licensed records the aggregator could have taken and did not. Licensing explains
    // the rest; this is the part that would still need explaining.
    unexplainedShortfall: onlyLeftRecords.filter(
      (r) => r.record.provenance.contentRedistributable,
    ).length,
  };
}
