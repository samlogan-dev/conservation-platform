import type { CorpusAnalysis } from "./analysis/coverage.ts";
import { HARVESTS, type HarvestDefinition } from "./config/harvests.ts";
import { REGIONS } from "./config/regions.ts";
import { SPECIES } from "./config/species.ts";
import { getFamily, getSynthesis } from "./corpusService.ts";
import { latestRunId, readManifest, type SnapshotManifest } from "./snapshot/store.ts";
import { recordStore } from "./store/recordStore.ts";
import { familyKeyOf } from "./synthesis/store.ts";
import { listClassificationRuns, readClassificationRun } from "./text/store.ts";
import type { ClassifierKey } from "./text/types.ts";
import { RECORD_TYPES } from "./canonical/recordType.ts";
import { getUnion } from "./union/store.ts";

/**
 * Read layer for the practitioner portal.
 *
 * The console reads one run at a time, because checking a harvest means checking a run. The
 * portal reads the current picture instead: for each species, region and window, the newest
 * run of every source. A reader picks a window, never a run, and every figure still names
 * the runs it came from.
 *
 * Nothing here writes, and nothing here returns a record. Record-level reads go through
 * corpusService, which is where the outbound protections live.
 */

/** A window is a family: one species, one region, one date range, every source that covers it. */
interface WindowDef {
  id: string;
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  harvests: HarvestDefinition[];
}

function windowDefs(): WindowDef[] {
  const byId = new Map<string, WindowDef>();
  for (const h of Object.values(HARVESTS)) {
    const id = familyKeyOf(h);
    const existing = byId.get(id);
    if (existing) existing.harvests.push(h);
    else
      byId.set(id, {
        id,
        speciesKey: h.speciesKey,
        regionKey: h.regionKey,
        startDate: h.startDate,
        endDate: h.endDate,
        harvests: [h],
      });
  }
  return [...byId.values()];
}

/** The calendar year a window covers exactly, or null for any other range. */
function calendarYear(w: { startDate: string; endDate: string }): number | null {
  const year = w.startDate.slice(0, 4);
  return w.startDate === `${year}-01-01` && w.endDate === `${year}-12-31` ? Number(year) : null;
}

// Runs are immutable, so their manifest and analysis are read once per process. A failed read
// is not cached: a run harvested but not yet adapted becomes readable once it is.
const analysisCache = new Map<string, CorpusAnalysis>();

async function adaptedAnalysis(harvestKey: string, runId: string): Promise<CorpusAnalysis | null> {
  const key = `${harvestKey}/${runId}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;
  try {
    const analysis = await recordStore.loadAnalysis(harvestKey, runId);
    analysisCache.set(key, analysis);
    return analysis;
  } catch {
    return null;
  }
}

interface Member {
  harvestKey: string;
  source: HarvestDefinition["source"];
  runId: string;
  manifest: SnapshotManifest;
  analysis: CorpusAnalysis;
}

/** The newest adapted run of each source in a window. A source with none is left out. */
async function members(w: WindowDef): Promise<Member[]> {
  const out: Member[] = [];
  for (const h of w.harvests) {
    const runId = await latestRunId(h.key);
    if (!runId) continue;
    const analysis = await adaptedAnalysis(h.key, runId);
    if (!analysis) continue;
    out.push({ harvestKey: h.key, source: h.source, runId, manifest: await readManifest(h.key, runId), analysis });
  }
  // Registry order, matching the order corpusService lists a family in.
  const order = Object.keys(HARVESTS);
  return out.sort((a, b) => order.indexOf(a.harvestKey) - order.indexOf(b.harvestKey));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Every species and region with harvested data, and the windows a reader can choose between. */
export async function listScopes() {
  const groups = new Map<string, { speciesKey: string; regionKey: string; windows: WindowDef[] }>();
  for (const w of windowDefs()) {
    const key = `${w.speciesKey}/${w.regionKey}`;
    const group = groups.get(key) ?? { speciesKey: w.speciesKey, regionKey: w.regionKey, windows: [] };
    group.windows.push(w);
    groups.set(key, group);
  }

  const scopes = [];
  for (const g of groups.values()) {
    const windows = [];
    for (const w of g.windows) {
      const ms = await members(w);
      if (ms.length === 0) continue;
      windows.push({
        id: w.id,
        startDate: w.startDate,
        endDate: w.endDate,
        calendarYear: calendarYear(w),
        inProgress: w.endDate >= today(),
        members: ms.map((m) => ({
          harvestKey: m.harvestKey,
          source: m.source,
          runId: m.runId,
          retrievedRecords: m.manifest.retrievedRecords,
          complete: m.manifest.complete,
        })),
      });
    }
    if (windows.length === 0) continue;
    // Newest first, and a calendar year ahead of a part-year window that starts on the same day.
    windows.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate));
    const species = SPECIES[g.speciesKey];
    scopes.push({
      speciesKey: g.speciesKey,
      vernacularName: species?.vernacularName ?? g.speciesKey,
      scientificName: species?.scientificName ?? null,
      regionKey: g.regionKey,
      regionLabel: REGIONS[g.regionKey]?.label ?? g.regionKey,
      windows,
    });
  }
  return scopes;
}

// ---------------------------------------------------------------- merged corpus

const refs = (ms: Member[]) =>
  ms.map((m) => ({ harvestKey: m.harvestKey, source: m.source, runId: m.runId, complete: m.manifest.complete }));

/**
 * The classifier whose labels a set of runs is read with: the model where it has read every
 * run, the keyword baseline where that has, otherwise none. One classifier across the set, so
 * a difference between years or record types is never a difference of classifier.
 */
async function classifierFor(ms: Member[]): Promise<ClassifierKey | null> {
  const sets = await Promise.all(
    ms.map(async (m) => new Set((await listClassificationRuns(m.harvestKey, m.runId)).map((c) => c.classifier))),
  );
  const everywhere = (c: ClassifierKey) => sets.length > 0 && sets.every((s) => s.has(c));
  return everywhere("llm") ? "llm" : everywhere("keyword") ? "keyword" : null;
}

/** The model and prompt behind a classifier's labels, read from one run it labelled. */
async function classifierInfo(ms: Member[], classifier: ClassifierKey | null) {
  const first = ms[0];
  if (!classifier || !first) return null;
  const run = await readClassificationRun(first.harvestKey, first.runId, classifier);
  return { classifier, model: run?.model ?? null, promptVersion: run?.promptVersion ?? null };
}

/**
 * One merged, de-duplicated summary per calendar year, for a species and region.
 *
 * Calendar years only, because a part-year window overlaps the year it sits in and the two
 * would count the same sightings twice. Years are merged one after another rather than all at
 * once: the first time, each means loading every source's records, and twelve years at once
 * would hold all of them in memory together. After that each year is a small stored file.
 */
export async function getTimeline(speciesKey: string, regionKey: string) {
  const windows = windowDefs()
    .filter((w) => w.speciesKey === speciesKey && w.regionKey === regionKey && calendarYear(w) !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (windows.length === 0) throw new Error(`no calendar-year windows for ${speciesKey} in ${regionKey}`);

  const perWindow = (await Promise.all(windows.map(async (w) => ({ w, members: await members(w) })))).filter(
    (p) => p.members.length > 0,
  );
  const all = perWindow.flatMap((p) => p.members);
  const classifier = await classifierFor(all);

  const years = [];
  for (const { w, members: ms } of perWindow) {
    years.push({
      year: calendarYear(w)!,
      windowId: w.id,
      inProgress: w.endDate >= today(),
      complete: ms.every((m) => m.manifest.complete),
      union: await getUnion(w.id, refs(ms), classifier),
    });
  }

  const species = SPECIES[speciesKey];
  return {
    speciesKey,
    vernacularName: species?.vernacularName ?? speciesKey,
    regionKey,
    regionLabel: REGIONS[regionKey]?.label ?? regionKey,
    classifier: await classifierInfo(all, classifier),
    recordTypes: RECORD_TYPES,
    years,
  };
}

// ---------------------------------------------------------------- one window

/** The run a window's family is read through: the newest adapted run of its first source. */
async function anchor(windowId: string): Promise<{ harvestKey: string; runId: string }> {
  const w = windowDefs().find((d) => d.id === windowId);
  if (!w) throw new Error(`no window "${windowId}"`);
  const [first] = await members(w);
  if (!first) throw new Error(`window "${windowId}" has no adapted runs yet`);
  return { harvestKey: first.harvestKey, runId: first.runId };
}

/** The window's sources merged into one de-duplicated corpus. */
export async function getWindowUnion(windowId: string) {
  const w = windowDefs().find((d) => d.id === windowId);
  if (!w) throw new Error(`no window "${windowId}"`);
  const ms = await members(w);
  if (ms.length === 0) throw new Error(`window "${windowId}" has no adapted runs yet`);
  const classifier = await classifierFor(ms);
  return {
    windowId,
    classifier: await classifierInfo(ms, classifier),
    recordTypes: RECORD_TYPES,
    union: await getUnion(w.id, refs(ms), classifier),
  };
}

/** Every source in the window, newest run of each, with the joins between them. */
export async function getWindowFamily(windowId: string) {
  const { harvestKey, runId } = await anchor(windowId);
  return getFamily(harvestKey, runId);
}

/** The stored AI analysis for a window, if one has been generated. The portal never generates one. */
export async function getWindowSynthesis(windowId: string) {
  const { harvestKey, runId } = await anchor(windowId);
  return getSynthesis(harvestKey, runId);
}
