import { createHash } from "node:crypto";
import type { CorpusAnalysis } from "../analysis/coverage.ts";
import type { SourceComparison } from "../analysis/compare.ts";
import type { TextSummary } from "../analysis/text.ts";
import type { SnapshotManifest } from "../snapshot/store.ts";
import { CONDITION_CODES, EVENT_CODES, SUBJECT_CODES } from "../text/taxonomy.ts";
import type { EvidencePack, EvidenceSection, Metric, MetricUnit } from "./types.ts";

/**
 * Build the evidence pack from a family: every source for one species, region and window,
 * the joins between them, and what each classifier read in the text.
 *
 * Only aggregates go in. No record, no coordinate, no remark, no observer — so nothing that
 * pillar 2 or 4 protects, and no contributor's licensed words, ever reaches the model here.
 */

/** The family as corpusService assembles it; declared structurally to avoid a circular import. */
export interface FamilyLike {
  speciesKey: string;
  regionKey: string;
  startDate: string;
  endDate: string;
  members: {
    harvestKey: string;
    runId: string;
    source: string;
    manifest: SnapshotManifest;
    analysis: CorpusAnalysis;
    text: TextSummary[];
  }[];
  comparisons: SourceComparison[];
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "unnamed";

const TOP = 5;

class SectionBuilder {
  readonly metrics: Metric[] = [];
  constructor(
    readonly key: string,
    readonly title: string,
  ) {}
  add(id: string, label: string, value: number | string | boolean | null | undefined, unit: MetricUnit): this {
    if (value === null || value === undefined) return this;
    if (typeof value === "number" && !Number.isFinite(value)) return this;
    this.metrics.push({ id: `${this.key}.${id}`, label, value, unit });
    return this;
  }
  done(): EvidenceSection {
    return { key: this.key, title: this.title, metrics: this.metrics };
  }
}

const share = (n: number, d: number): number => (d === 0 ? 0 : n / d);

export function buildEvidence(family: FamilyLike): EvidencePack {
  const sections: EvidenceSection[] = [];

  // ---- One section per source: what was fetched and what it holds.
  for (const m of family.members) {
    const src = m.source;
    const a = m.analysis;
    const s = new SectionBuilder(`source.${src}`, `${src}: what was fetched`);
    s.add("records", "sightings retrieved", a.totalRecords, "count")
      .add("expected_records", "sightings the source reported for the window", m.manifest.expectedRecords, "count")
      .add("complete", "every slice reconciled (harvest complete)", m.manifest.complete, "flag")
      .add("requests", "API requests made", m.manifest.requestCount, "count")
      .add("valid_records", "records passing basic validation", a.validRecords, "count")
      .add("datasets", "contributing datasets inside this source", a.resources.length, "count");

    // Two free-text fields. The classifiers read both; the per-dataset counts below cover only
    // occurrenceRemarks, so a dataset can show no substantive remarks and still have labelled
    // text — the labels say which field each figure describes so the model does not have to guess.
    const remarks = a.freeText.find((f) => f.canonicalField === "occurrenceRemarks");
    if (remarks) {
      s.add("text.substantive", "records with substantive occurrenceRemarks (3+ words)", remarks.bands.substantive, "count")
        .add("text.substantive_share", "share of records with substantive occurrenceRemarks", remarks.substantiveShare, "share")
        .add("text.populated_share", "share of records with anything in occurrenceRemarks", 1 - share(remarks.bands.absent, remarks.total), "share")
        .add("text.median_chars", "median length of occurrenceRemarks", remarks.medianLength, "chars");
    }
    const events = a.freeText.find((f) => f.canonicalField === "eventRemarks");
    if (events) {
      s.add("text.event_remarks_substantive", "records with substantive eventRemarks (the second free-text field, also classified)", events.bands.substantive, "count");
    }

    const obscured = a.resources.reduce((sum, r) => sum + r.obscuredRecords, 0);
    s.add("obscured_records", "records with coordinate uncertainty beyond 10 km (deliberate obscuring)", obscured, "count")
      .add("obscured_share", "share of records obscured beyond 10 km", share(obscured, a.totalRecords), "share");

    for (const r of a.resources.slice(0, TOP)) {
      const d = `dataset.${slug(r.dataResourceName)}`;
      s.add(`${d}.records`, `${r.dataResourceName}: records`, r.records, "count")
        .add(`${d}.share`, `${r.dataResourceName}: share of this source`, r.share, "share")
        .add(`${d}.substantive_text`, `${r.dataResourceName}: records with substantive occurrenceRemarks`, r.substantiveRemarks, "count")
        .add(`${d}.median_uncertainty_m`, `${r.dataResourceName}: median coordinate uncertainty`, r.medianCoordinateUncertainty === null ? null : Math.round(r.medianCoordinateUncertainty), "metres")
        .add(`${d}.obscured`, `${r.dataResourceName}: records obscured beyond 10 km`, r.obscuredRecords, "count");
    }

    for (const f of a.sourceAssertions.slice(0, TOP)) {
      s.add(`flag.${slug(f.assertion)}.share`, `source quality flag "${f.assertion}": share of records it fires on`, f.share, "share");
    }
    for (const v of a.validation.slice(0, 3)) {
      s.add(`validation.${slug(v.code)}.count`, `validation issue ${v.code} (${v.severity}): records`, v.count, "count");
    }
    sections.push(s.done());
  }

  // ---- The joins: same sightings seen through two sources.
  for (const c of family.comparisons) {
    const key = `join.${c.left.source}-${c.right.source}`;
    const s = new SectionBuilder(key, `${c.left.source} → ${c.right.source}: the same sightings through both sources`);
    s.add("namespace", "identifier namespace both sides were restricted to", c.namespace, "text")
      .add("left_corpus", `${c.left.source}: whole corpus`, c.left.corpusRecords, "count")
      .add("right_corpus", `${c.right.source}: whole corpus`, c.right.corpusRecords, "count")
      .add("left_in_namespace", `${c.left.source}: records inside the shared namespace`, c.left.totalRecords, "count")
      .add("right_in_namespace", `${c.right.source}: records inside the shared namespace`, c.right.totalRecords, "count")
      .add("matched", "sightings present in both", c.matched, "count")
      .add("only_left", `sightings only in ${c.left.source} (never reached ${c.right.source})`, c.onlyLeft, "count")
      .add("only_right", `sightings only in ${c.right.source}`, c.onlyRight, "count")
      .add("coverage_of_left", `share of ${c.left.source}'s sightings that ${c.right.source} holds`, c.coverageOfLeft, "share")
      .add("matched_text_left", `matched sightings with substantive text in ${c.left.source}`, c.matchedTextLeft, "count")
      .add("matched_text_right", `matched sightings with substantive text in ${c.right.source}`, c.matchedTextRight, "count")
      .add("matched_obscured_left", `matched sightings obscured beyond 10 km in ${c.left.source}`, c.matchedObscuredLeft, "count")
      .add("matched_obscured_right", `matched sightings obscured beyond 10 km in ${c.right.source}`, c.matchedObscuredRight, "count");

    const reserved = c.onlyLeftByLicence.filter((b) => !b.redistributable).reduce((sum, b) => sum + b.records, 0);
    s.add("only_left_reserved", `of the sightings only in ${c.left.source}, how many are all-rights-reserved`, reserved, "count")
      .add("only_left_explained_by_licence", "share of the gap explained by licensing", c.onlyLeft === 0 ? 0 : (c.onlyLeft - c.unexplainedShortfall) / c.onlyLeft, "share")
      .add("unexplained_shortfall", "openly licensed sightings missing and not explained by licence", c.unexplainedShortfall, "count");
    for (const b of c.onlyLeftByLicence.slice(0, 3)) {
      s.add(`only_left_licence.${slug(b.license)}.records`, `sightings only in ${c.left.source} under licence "${b.license}"`, b.records, "count");
    }
    sections.push(s.done());
  }

  // ---- What the classifiers read in the free text, per source and classifier.
  for (const m of family.members) {
    for (const t of m.text) {
      const key = `text.${m.source}.${t.classifier}`;
      const who = t.classifier === "llm" ? `model ${t.model}` : "keyword baseline";
      const s = new SectionBuilder(key, `${m.source}: what the free text says (${who})`);
      s.add("classifier", "classifier", t.classifier === "llm" ? `llm (${t.model}, prompt ${t.promptVersion})` : "keyword baseline (regular expressions)", "text")
        .add("unique_texts", "distinct substantive texts in this source", t.uniqueTexts, "count")
        .add("labelled_texts", "distinct texts this classifier has labelled so far", t.labelledTexts, "count")
        .add("complete", "every text labelled (a checkpointed pass in progress says no)", t.labelledTexts >= t.uniqueTexts, "flag")
        .add("records_covered", "records with at least one labelled remark", t.recordsCovered, "count")
        .add("koala_records", "remarks judged to be about a koala (denominator for the rates below)", t.koalaRecords, "count");
      for (const code of SUBJECT_CODES) s.add(`subject.${code}`, `subject ${code}`, t.bySubject[code], "count");
      for (const code of CONDITION_CODES) s.add(`condition.${code}`, `koala remarks stating condition ${code}`, t.byCondition[code], "count");
      s.add("harm_share", "share of koala remarks describing a sick, injured or dead koala", share(t.byCondition.dead + t.byCondition.alive_unwell, t.koalaRecords), "share");
      for (const code of EVENT_CODES) s.add(`event.${code}`, `koala remarks naming ${code.replace(/_/g, " ")}`, t.byEvent[code], "count");

      for (const mo of t.byMonth) {
        if (mo.month === "unknown") continue;
        const p = `month.${mo.month}`;
        s.add(`${p}.records`, `${mo.month}: koala remarks`, mo.records, "count")
          .add(`${p}.dead`, `${mo.month}: dead`, mo.dead, "count")
          .add(`${p}.unwell`, `${mo.month}: unwell`, mo.unwell, "count")
          .add(`${p}.vehicle_strike`, `${mo.month}: vehicle strike`, mo.vehicle_strike, "count")
          .add(`${p}.dog_attack`, `${mo.month}: dog attack`, mo.dog_attack, "count")
          .add(`${p}.disease`, `${mo.month}: disease`, mo.disease, "count")
          .add(`${p}.fire`, `${mo.month}: fire`, mo.fire, "count");
      }
      for (const d of t.byDataset.slice(0, TOP)) {
        const p = `dataset.${slug(d.dataResourceName)}`;
        s.add(`${p}.records`, `${d.dataResourceName}: koala remarks`, d.records, "count")
          .add(`${p}.dead`, `${d.dataResourceName}: dead`, d.dead, "count")
          .add(`${p}.unwell`, `${d.dataResourceName}: unwell`, d.unwell, "count")
          .add(`${p}.disease`, `${d.dataResourceName}: disease`, d.events.disease, "count")
          .add(`${p}.vehicle_strike`, `${d.dataResourceName}: vehicle strike`, d.events.vehicle_strike, "count");
      }
      if (t.agreement && t.agreement.texts > 0) {
        const p = `agreement.${t.agreement.with}`;
        s.add(`${p}.texts`, `texts also labelled by the ${t.agreement.with} classifier`, t.agreement.texts, "count")
          .add(`${p}.subject_share`, "agreement on subject", share(t.agreement.subject, t.agreement.texts), "share")
          .add(`${p}.condition_share`, "agreement on condition", share(t.agreement.condition, t.agreement.texts), "share")
          .add(`${p}.events_share`, "agreement on events", share(t.agreement.events, t.agreement.texts), "share");
      }
      sections.push(s.done());
    }
  }

  const metricCount = sections.reduce((sum, s) => sum + s.metrics.length, 0);
  // The hash is over ids and values — the numbers — so "stale" means the numbers changed. Label
  // wording is part of the prompt and is covered by the prompt version, not by this.
  const numbers = sections.flatMap((s) => s.metrics.map((m) => [m.id, m.value]));
  return {
    scope: {
      speciesKey: family.speciesKey,
      regionKey: family.regionKey,
      startDate: family.startDate,
      endDate: family.endDate,
      sources: family.members.map((m) => m.source),
    },
    sections,
    metricCount,
    hash: createHash("sha256").update(JSON.stringify(numbers)).digest("hex"),
  };
}

/** How a value is shown, to the model and to the reader: the same rendering in both places. */
export function renderValue(m: Pick<Metric, "value" | "unit">): string {
  if (typeof m.value === "boolean") return m.value ? "yes" : "no";
  if (typeof m.value === "string") return m.value;
  switch (m.unit) {
    case "share":
      return `${(m.value * 100).toFixed(1)}%`;
    case "metres":
      return `${Math.round(m.value).toLocaleString("en-AU")} m`;
    case "chars":
      return `${Math.round(m.value)} characters`;
    default:
      return m.value.toLocaleString("en-AU");
  }
}

/** The pack as the model receives it: one line per metric, id first so it can be cited. */
export function renderForModel(pack: EvidencePack): string {
  const lines: string[] = [];
  lines.push(`Species: ${pack.scope.speciesKey}. Region: ${pack.scope.regionKey}. Window: ${pack.scope.startDate} to ${pack.scope.endDate}.`);
  lines.push(`Sources: ${pack.scope.sources.join(", ")}. Metrics: ${pack.metricCount}.`);
  for (const s of pack.sections) {
    lines.push("");
    lines.push(`## ${s.title}`);
    for (const m of s.metrics) lines.push(`${m.id} = ${renderValue(m)}  — ${m.label}`);
  }
  return lines.join("\n");
}
