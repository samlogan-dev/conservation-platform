<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EvidenceMetric, Insight, InsightKind, SynthesisStatus } from '@/apis/corpusTypes'
import { num, shortHash } from '@/lib/format'

/**
 * The model's checked reading of a window, and the evidence it was given.
 *
 * Shared by both surfaces: the portal shows it read-only, the console wraps it in the button
 * that generates it. What the reader sees is the stored answer after the server has checked
 * every cited metric and every number in the prose against the evidence, the evidence itself,
 * and wherever the two disagree.
 */
const props = defineProps<{ status: SynthesisStatus }>()

const showEvidence = ref(false)

const synthesis = computed(() => props.status.synthesis)

const metricById = computed(() => {
  const map = new Map<string, EvidenceMetric>()
  for (const s of props.status.evidence.sections) for (const m of s.metrics) map.set(m.id, m)
  return map
})

/** Same rendering the model saw, so a chip and the evidence line read identically. */
function renderValue(m: EvidenceMetric): string {
  if (typeof m.value === 'boolean') return m.value ? 'yes' : 'no'
  if (typeof m.value === 'string') return m.value
  switch (m.unit) {
    case 'share':
      return `${(m.value * 100).toFixed(1)}%`
    case 'metres':
      return `${num(Math.round(m.value))} m`
    case 'chars':
      return `${Math.round(m.value)} characters`
    default:
      return num(m.value)
  }
}

/**
 * A chip per cited metric. Per-source and per-classifier labels do not name their source (the
 * id does), so the source is read off the id and put in front: "ala · sightings retrieved".
 */
function citations(i: Insight) {
  return i.evidence.flatMap((id) => {
    const m = metricById.value.get(id)
    if (!m) return []
    const [kind, source, third] = id.split('.')
    const prefix = kind === 'source' ? source : kind === 'text' ? `${source} ${third}` : null
    return [{ id, label: prefix ? `${prefix} · ${m.label}` : m.label, value: renderValue(m) }]
  })
}

/** Highest value first; the model's own order breaks ties. */
const insights = computed(() => {
  const list = synthesis.value?.report.insights ?? []
  return list.map((i, index) => ({ i, index })).sort((a, b) => b.i.value - a.i.value || a.index - b.index).map((x) => x.i)
})

const KIND_LABEL: Record<InsightKind, string> = {
  finding: 'Finding',
  data_quality: 'Data quality',
  interpretation: 'Interpretation',
}
const KIND_CLASS: Record<InsightKind, string> = {
  finding: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  data_quality: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  interpretation: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
}

const dots = (value: number) => '●'.repeat(value) + '○'.repeat(Math.max(0, 5 - value))

const generatedAt = computed(() => (synthesis.value ? synthesis.value.finishedAt.replace('T', ' ').slice(0, 16) + ' UTC' : ''))
</script>

<template>
  <div class="space-y-6">
    <!-- The checked answer -->
    <template v-if="synthesis">
      <section class="rounded border border-border p-5">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground">What matters most</p>
        <p class="mt-1 text-xl leading-snug">{{ synthesis.report.headline }}</p>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="(i, n) in insights" :key="n" class="min-w-0 rounded border border-border p-5">
          <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <span class="rounded px-1.5 py-0.5 font-medium" :class="KIND_CLASS[i.kind]">{{ KIND_LABEL[i.kind] }}</span>
            <span class="font-mono text-muted-foreground" :title="`value to a practitioner, ${i.value} of 5`">{{ dots(i.value) }}</span>
            <span class="text-muted-foreground">{{ i.confidence }} confidence</span>
          </div>
          <h2 class="mt-2 text-sm font-semibold">{{ i.title }}</h2>
          <p class="mt-1 text-base leading-snug">{{ i.essence }}</p>
          <p class="mt-2 text-xs text-muted-foreground">{{ i.detail }}</p>
          <p v-if="i.caveat" class="mt-2 text-xs text-amber-700 dark:text-amber-400">Caveat: {{ i.caveat }}</p>

          <ul v-if="citations(i).length" class="mt-3 flex flex-wrap gap-1.5">
            <li
              v-for="c in citations(i)"
              :key="c.id"
              class="rounded bg-muted px-1.5 py-0.5 text-[11px]"
              :title="c.id"
            >
              <span class="text-muted-foreground">{{ c.label }}</span>
              <span class="ml-1 font-mono">{{ c.value }}</span>
            </li>
          </ul>

          <p v-if="i.checks.unknownCitations.length" class="mt-2 text-[11px] text-rose-700 dark:text-rose-400">
            Cites {{ i.checks.unknownCitations.length }} metric{{ i.checks.unknownCitations.length === 1 ? '' : 's' }} not in the evidence:
            <span class="font-mono">{{ i.checks.unknownCitations.join(', ') }}</span>
          </p>
          <p v-if="i.checks.unverifiedNumbers.length" class="mt-1 text-[11px] text-rose-700 dark:text-rose-400">
            Numbers not found in the evidence: <span class="font-mono">{{ i.checks.unverifiedNumbers.join(', ') }}</span>
          </p>
        </article>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <section v-if="synthesis.report.limitations.length" class="rounded border border-border p-5">
          <h2 class="text-sm font-semibold">What this evidence cannot say</h2>
          <ul class="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li v-for="(l, n) in synthesis.report.limitations" :key="n">{{ l }}</li>
          </ul>
        </section>
        <section v-if="synthesis.report.nextQuestions.length" class="rounded border border-border p-5">
          <h2 class="text-sm font-semibold">Questions the data raises</h2>
          <ul class="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li v-for="(q, n) in synthesis.report.nextQuestions" :key="n">{{ q }}</li>
          </ul>
        </section>
      </div>

      <p class="text-[11px] text-muted-foreground">
        Generated {{ generatedAt }} by <span class="font-mono">{{ synthesis.model }}</span>, prompt v{{ synthesis.promptVersion }},
        {{ synthesis.temperature === null ? 'temperature not settable on this model' : `temperature ${synthesis.temperature}` }},
        from {{ num(synthesis.metricCount) }} metrics (evidence <span class="font-mono" :title="synthesis.evidenceHash">{{ shortHash(synthesis.evidenceHash) }}</span>).
        {{ num(synthesis.usage.inputTokens) }} tokens in, {{ num(synthesis.usage.outputTokens) }} out.
        Checks: {{ synthesis.checks.unknownCitations }} unknown citation{{ synthesis.checks.unknownCitations === 1 ? '' : 's' }},
        {{ synthesis.checks.unverifiedNumbers }} unverified number{{ synthesis.checks.unverifiedNumbers === 1 ? '' : 's' }}.
      </p>
    </template>

    <!-- The evidence, exactly as the model received it -->
    <section class="rounded border border-border">
      <button
        type="button"
        class="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold hover:bg-muted/50"
        @click="showEvidence = !showEvidence"
      >
        <span>What the model was given <span class="font-normal text-muted-foreground">· {{ num(status.evidence.metricCount) }} metrics in {{ status.evidence.sections.length }} sections</span></span>
        <span class="text-xs text-muted-foreground">{{ showEvidence ? 'hide' : 'show' }}</span>
      </button>
      <div v-if="showEvidence" class="space-y-5 border-t border-border px-5 py-4">
        <div v-for="s in status.evidence.sections" :key="s.key">
          <h3 class="text-xs font-semibold">{{ s.title }}</h3>
          <div class="mt-1 overflow-x-auto">
            <table class="w-full text-[11px]">
              <tbody>
                <tr v-for="m in s.metrics" :key="m.id" class="border-t border-border/60">
                  <td class="py-0.5 pr-3 font-mono text-muted-foreground">{{ m.id }}</td>
                  <td class="py-0.5 pr-3">{{ m.label }}</td>
                  <td class="py-0.5 text-right font-mono">{{ renderValue(m) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
