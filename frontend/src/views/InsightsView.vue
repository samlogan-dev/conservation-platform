<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import { num, pct, sourceLabel } from '@/lib/format'

/**
 * Page 4 — what the statistics mean, across every source.
 *
 * Each card is one question a reader would actually ask, answered in a sentence, with the
 * evidence underneath. Everything is computed from the family on page 3: every source for the
 * same species, region and window, and the joins between them. Nothing here is a model
 * output; these are the findings the pipeline can state on its own.
 */

const store = useCorpusStore()
const { family } = storeToRefs(store)

type Tone = 'good' | 'warn' | 'neutral'

interface Finding {
  key: string
  question: string
  verdict: string
  tone: Tone
  evidence: string[]
}

const findings = computed<Finding[]>(() => {
  const fam = family.value
  if (!fam || fam.members.length === 0) return []
  const members = fam.members
  const out: Finding[] = []

  // ---- Across sources: coverage, content, and whether the privacy signal survives.
  for (const c of fam.comparisons) {
    const left = sourceLabel(c.left.source)
    const right = sourceLabel(c.right.source)
    const explainedByLicence =
      c.onlyLeft === 0 ? 0 : (c.onlyLeft - c.unexplainedShortfall) / c.onlyLeft
    const reserved = c.onlyLeftByLicence
      .filter((b) => !b.redistributable)
      .reduce((sum, b) => sum + b.records, 0)

    out.push({
      key: `coverage-${c.left.harvestKey}`,
      question: `How much of ${left}'s record reaches ${right}?`,
      verdict: `${pct(c.coverageOfLeft, 0)} of ${num(c.left.totalRecords)} sightings`,
      tone: c.coverageOfLeft >= 0.9 ? 'good' : 'warn',
      evidence: [
        `${num(c.matched)} sightings appear in both. ${num(c.onlyLeft)} never reached ${right}.`,
        `${pct(explainedByLicence, 0)} of the gap is licensing: ${num(reserved)} are all-rights-reserved, and a platform only exports what its contributors licensed it to export.`,
        c.unexplainedShortfall
          ? `${num(c.unexplainedShortfall)} openly licensed sightings are missing and not yet explained.`
          : 'Every missing sighting is accounted for by its licence.',
      ],
    })

    const preserved = c.matchedTextLeft === c.matchedTextRight
    out.push({
      key: `content-${c.left.harvestKey}`,
      question: `Does ${right} change what it passes on?`,
      verdict: preserved ? 'No content loss' : 'Content differs',
      tone: preserved ? 'good' : 'warn',
      evidence: [
        `Across the ${num(c.matched)} sightings both hold, ${left} has ${num(c.matchedTextLeft)} with substantive text and ${right} has ${num(c.matchedTextRight)}.`,
        preserved
          ? 'The gap between the sources is entirely in which sightings arrive, not in what they contain.'
          : 'The aggregator holds the sighting but not all of its text, a loss distinct from coverage.',
      ],
    })

    const signalKept = c.matchedObscuredLeft === c.matchedObscuredRight
    out.push({
      key: `obscuring-${c.left.harvestKey}`,
      question: 'Does coordinate obscuring survive the trip?',
      verdict: signalKept
        ? `Yes: ${num(c.matchedObscuredLeft)} obscured on both sides`
        : `No: ${left} marks ${num(c.matchedObscuredLeft)}, ${right} marks ${num(c.matchedObscuredRight)}`,
      tone: signalKept ? 'good' : 'warn',
      evidence: [
        `Counted only across the ${num(c.matched)} sightings both hold, as records with uncertainty beyond 10 km.`,
        signalKept
          ? 'A precision rule would see the same thing from either source.'
          : `${right}'s copy does not carry the obscuring ${left} applied. A precision or range rule reading ${right} alone would treat those points as more exact than they are.`,
      ],
    })
  }

  // ---- Free text: is there enough for the LLM arm at all, across all sources?
  const remarks = members.flatMap((m) => {
    const f = m.analysis.freeText.find((x) => x.canonicalField === 'occurrenceRemarks')
    return f ? [{ label: sourceLabel(m.source), f }] : []
  })
  const textTotal = remarks.reduce((sum, r) => sum + r.f.total, 0)
  if (textTotal > 0) {
    const substantive = remarks.reduce((sum, r) => sum + r.f.bands.substantive, 0)
    const absent = remarks.reduce((sum, r) => sum + r.f.bands.absent, 0)
    const share = substantive / textTotal
    const populated = 1 - absent / textTotal
    out.push({
      key: 'free-text',
      question: 'Is there enough free text for an LLM to classify?',
      verdict: `${pct(share)} of records carry a sentence worth reading`,
      tone: share >= 0.3 ? 'good' : 'warn',
      evidence: [
        ...remarks.map(
          (r) => `${r.label}: ${pct(r.f.substantiveShare)} substantive (${num(r.f.bands.substantive)} of ${num(r.f.total)}), median ${r.f.medianLength} characters.`,
        ),
        `${pct(populated)} have something in the field. Counting presence instead of substance would overstate the answer by ${Math.round((populated - share) * 100)} points.`,
      ],
    })
  }

  // ---- Which datasets carry the text, as opposed to the records, across all sources.
  const datasets = members.flatMap((m) =>
    m.analysis.resources.map((r) => ({ ...r, label: `${r.dataResourceName} (${sourceLabel(m.source)})` })),
  )
  const totalText = datasets.reduce((sum, d) => sum + d.substantiveRemarks, 0)
  const totalRecords = datasets.reduce((sum, d) => sum + d.records, 0)
  if (datasets.length > 1 && totalText > 0) {
    const rate = (d: { records: number; substantiveRemarks: number }) =>
      d.records === 0 ? 0 : d.substantiveRemarks / d.records
    const byRecords = [...datasets].sort((x, y) => y.records - x.records)[0]!
    const byText = [...datasets].sort((x, y) => y.substantiveRemarks - x.substantiveRemarks)[0]!
    const richest = [...datasets].filter((d) => d.records >= 20).sort((x, y) => rate(y) - rate(x))[0]
    out.push({
      key: 'text-by-dataset',
      question: 'Which datasets supply the usable text?',
      verdict: `${byText.label} supplies ${pct(byText.substantiveRemarks / totalText, 0)} of it`,
      tone: 'neutral',
      evidence: [
        `${byRecords.label} supplies ${pct(byRecords.records / totalRecords, 0)} of all records and ${pct(byRecords.substantiveRemarks / totalText, 0)} of the substantive text.`,
        ...(richest
          ? [`Per record, ${richest.label} is the richest: ${pct(rate(richest), 0)} of its records carry substantive text.`]
          : []),
      ],
    })
  }

  // ---- Location precision, per source, and the obscuring a threatened species attracts.
  const precision = members.map((m) => {
    const total = m.analysis.totalRecords
    const obscured = m.analysis.resources.reduce((sum, r) => sum + r.obscuredRecords, 0)
    const medians = m.analysis.resources
      .filter((r) => r.medianCoordinateUncertainty !== null)
      .map((r) => `${r.dataResourceName} ${num(Math.round(r.medianCoordinateUncertainty!))} m`)
    return { label: sourceLabel(m.source), total, obscured, share: total ? obscured / total : 0, medians }
  })
  if (precision.some((p) => p.medians.length)) {
    const worst = [...precision].sort((a, b) => b.share - a.share)[0]!
    out.push({
      key: 'precision',
      question: 'How precisely are sightings located?',
      verdict: worst.obscured
        ? `${pct(worst.share)} of ${worst.label}'s sightings are obscured beyond 10 km`
        : 'No sighting is obscured beyond 10 km',
      tone: worst.share > 0.05 ? 'warn' : 'good',
      evidence: [
        ...precision.map(
          (p) => `${p.label}: ${num(p.obscured)} of ${num(p.total)} (${pct(p.share)}) obscured${p.medians.length ? `. Median uncertainty: ${p.medians.join(', ')}` : ''}.`,
        ),
        'Deliberate obscuring for a threatened species is a privacy mechanism, not an error. A range or precision rule that fires on it is producing false positives.',
      ],
    })
  }

  // ---- Are the quality flags a baseline worth measuring against? One card per vocabulary.
  for (const m of members) {
    const flags = m.analysis.sourceAssertions
    if (!flags.length) continue
    const label = sourceLabel(m.source)
    const universal = flags.filter((s) => s.share >= 0.999)
    const informative = flags.filter((s) => s.share < 0.999).slice(0, 3)
    out.push({
      key: `flags-${m.harvestKey}`,
      question: `Are ${label}'s quality flags a useful baseline?`,
      verdict: universal.length
        ? `${universal.length} of ${flags.length} flags fire on every record`
        : `${flags.length} flags, none universal`,
      tone: universal.length ? 'warn' : 'good',
      evidence: [
        ...(universal.length ? [`${universal.map((u) => u.assertion).join(', ')} discriminate nothing.`] : []),
        informative.length
          ? `The informative ones: ${informative.map((i) => `${i.assertion} (${pct(i.share, 0)})`).join(', ')}.`
          : 'No flag varies across the corpus.',
      ],
    })
  }

  return out
})

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  neutral: '',
}
</script>

<template>
  <div v-if="family" class="space-y-6 p-6">
    <p class="max-w-3xl text-xs text-muted-foreground">
      What the statistics mean, one question at a time, across every source for
      {{ family.speciesKey }} in {{ family.regionKey }}, {{ family.startDate }} to
      {{ family.endDate }}. Nothing here is a model output.
    </p>

    <div class="grid gap-4 lg:grid-cols-2">
      <article v-for="f in findings" :key="f.key" class="min-w-0 rounded border border-border p-5">
        <h2 class="text-sm font-semibold">{{ f.question }}</h2>
        <p class="mt-2 text-xl" :class="TONE_CLASS[f.tone]">{{ f.verdict }}</p>
        <ul class="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <li v-for="(line, i) in f.evidence" :key="i">{{ line }}</li>
        </ul>
      </article>
    </div>

    <p v-if="findings.length === 0" class="text-sm text-muted-foreground">
      Nothing to say yet about these sources.
    </p>
  </div>
</template>
