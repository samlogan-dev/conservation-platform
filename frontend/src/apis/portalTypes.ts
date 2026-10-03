import type { ClassifierKey, RecordType, TextCondition, TextEvent } from "./corpusTypes";

/**
 * Shapes returned by the portal API (backend/src/ingestion/portalService.ts). The portal
 * addresses data by window — species, region, date range — and reads every window as one
 * merged, de-duplicated corpus, split by record type rather than by source.
 */

export interface WindowMember {
  harvestKey: string;
  source: string;
  runId: string;
  retrievedRecords: number;
  complete: boolean;
}

export interface PortalWindow {
  /** speciesKey__regionKey__startDate__endDate — the same key the stored AI analysis is filed under. */
  id: string;
  startDate: string;
  endDate: string;
  /** The calendar year the window covers exactly, or null for any other range. */
  calendarYear: number | null;
  /** The window has not ended yet, so its counts will grow. */
  inProgress: boolean;
  members: WindowMember[];
}

export interface PortalScope {
  speciesKey: string;
  vernacularName: string;
  scientificName: string | null;
  regionKey: string;
  regionLabel: string;
  /** Newest first. */
  windows: PortalWindow[];
}

export interface PortalInfo {
  /** Whether the server exposes the console, and so whether the portal may link into it. */
  consoleEnabled: boolean;
  scopes: PortalScope[];
}

// ---- The merged corpus

export interface Tally {
  records: number;
  /** Location deliberately blurred beyond 10 km — a privacy measure, not an error. */
  obscured: number;
  /** Passed the canonical schema's structural checks. */
  valid: number;
  /** Records whose remarks a classifier judged to be about a koala: the denominator for the rest. */
  remarksRead: number;
  byCondition: Record<TextCondition, number>;
  byEvent: Record<TextEvent, number>;
}

export interface UnionSource {
  source: string;
  harvestKey: string;
  runId: string;
  complete: boolean;
  records: number;
  /** Observations no other source holds. */
  onlyHere: number;
  shared: number;
}

export interface UnionDataset {
  dataResourceUid: string | null;
  dataResourceName: string;
  /** Distinct sightings after copies held elsewhere were removed. */
  records: number;
  byType: Partial<Record<RecordType, number>>;
}

export interface UnionSummary {
  familyKey: string;
  computedAt: string;
  classifier: ClassifierKey | null;
  /** Distinct sightings across every source. */
  distinct: number;
  /** Copies of an observation already counted from another source. */
  duplicatesRemoved: number;
  sources: UnionSource[];
  total: Tally;
  byType: Record<RecordType, Tally>;
  byDataset: UnionDataset[];
}

export interface RecordTypeInfo {
  label: string;
  description: string;
}

export interface ClassifierInfo {
  classifier: ClassifierKey;
  model: string | null;
  promptVersion: string | null;
}

export interface WindowUnion {
  windowId: string;
  classifier: ClassifierInfo | null;
  recordTypes: Record<RecordType, RecordTypeInfo>;
  union: UnionSummary;
}

export interface TimelineYear {
  year: number;
  windowId: string;
  inProgress: boolean;
  /** Every source's fetch retrieved everything it reported. */
  complete: boolean;
  union: UnionSummary;
}

export interface Timeline {
  speciesKey: string;
  vernacularName: string;
  regionKey: string;
  regionLabel: string;
  /** The one classifier every year was read with, or null when no classifier covers them all. */
  classifier: ClassifierInfo | null;
  recordTypes: Record<RecordType, RecordTypeInfo>;
  years: TimelineYear[];
}
