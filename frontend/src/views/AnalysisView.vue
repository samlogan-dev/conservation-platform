<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import { getSynthesisAPI, runSynthesisAPI } from '@/apis/corpusAPI'
import type { EvidenceMetric, Insight, InsightKind, SynthesisStatus } from '@/apis/corpusTypes'
import { num, shortHash } from '@/lib/format'

/**
 * Page 5 — the model's reading of pages 3 and 4.
 *
 * The model is given the family's numbers as a list of named metrics — nothing per record, no
 * text, no coordinates — and asked what matters most to a practitioner. Its answer comes back
 * through a fixed schema, and the server checks every metric it cites and every number in
 * its prose against the evidence before storing it. What the page shows is that checked
 * answer, the evidence it was given, and the two side by side: the reader can see exactly
 * what the model had, and exactly where it said something the evidence did not contain.
 */

const store = useCorpusStore()
const { harvestKey, runId } = storeToRefs(store)

const status = ref<SynthesisStatus | null>(null)
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const showEvidence = ref(false)

function describeError(e: unknown): string {
  const response = (e as { response?: { data?: { message?: string } } }).response
  return response?.data?.message ?? (e instanceof Error ? e.message : String(e))
}

async function load() {
  if (!harvestKey.value || !runId.value) return
  loading.value = true
  error.value = null
  try {
    status.value = await getSynthesisAPI(harvestKey.value, runId.value)
  } catch (e) {
    error.value = describeError(e)
    status.value = null
  } finally {
    loading.value = false
  }
}

watch([harvestKey, runId], load, { immediate: true })

async function generate(force: boolean) {
  if (!harvestKey.value || !runId.value || running.value) return
  running.value = true
  error.value = null
  try {
    const synthesis = await runSynthesisAPI(harvestKey.value, runId.value, force)
    // Re-read rather than splice: the server decides what "stale" means.
    await load()
    if (status.value && !status.value.synthesis) status.value.synthesis = synthesis
  } catch (e) {
    error.value = describeError(e)
  } finally {
    running.value = false
  }
}

const synthesis = computed(() => status.value?.synthesis ?? null)

const metricById = computed(() => {
  const map = new Map<string, EvidenceMetric>()
  for (const s of status.value?.evidence.sections ?? []) for (const m of s.metrics) map.set(m.id, m)
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
  <div class="space-y-6 p-6">
    <p class="max-w-3xl text-xs text-muted-foreground">
      The model's reading of pages 3 and 4. It is given the numbers below — every source for this
      species, region and window, the joins between them, and what the classifiers read in the
      text — and nothing else: no record, no remark, no coordinate. Every metric it cites and every
      number in its prose is checked against that evidence before it is shown here.
    </p>

    <p v-if="loading && !status" class="text-sm text-muted-foreground">Loading…</p>

    <template v-if="status">
      <!-- Toolbar: what would be asked, of which model, and the one button that asks it. -->
      <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-muted/30 px-4 py-3 text-xs">
        <div class="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div>
            <span class="text-muted-foreground">model</span>
            <span class="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono">{{ status.model }}</span>
          </div>
          <div>
            <span class="text-muted-foreground">prompt</span>
            <span class="ml-2 font-mono">v{{ status.promptVersion }}</span>
          </div>
          <div :title="status.evidence.hash">
            <span class="text-muted-foreground">evidence</span>
            <span class="ml-2 font-mono">{{ num(status.evidence.metricCount) }} metrics · {{ shortHash(status.evidence.hash) }}</span>
          </div>
          <span
            v-if="synthesis && status.stale"
            class="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            title="A run or a classifier pass has changed the family's numbers since this analysis was generated."
          >numbers have changed since this was generated</span>
        </div>

        <div class="flex items-center gap-3">
          <span v-if="running" class="text-muted-foreground">Asking {{ status.model }}…</span>
          <template v-else-if="status.configured">
            <button
              type="button"
              class="rounded border border-border bg-background px-3 py-1 font-medium hover:bg-muted disabled:opacity-50"
              :disabled="running || status.running"
              :title="synthesis ? 'One model call over the evidence above; replaces the stored analysis' : 'One model call over the evidence above'"
              @click="generate(!!synthesis)"
            >{{ synthesis ? 'Regenerate analysis' : 'Generate analysis' }}</button>
          </template>
          <span v-else class="text-amber-700 dark:text-amber-400">
            No Anthropic key configured — put <code class="font-mono">CLAUDE_API_KEY</code> in backend/.env and restart.
          </span>
        </div>
      </div>

      <div v-if="error" class="rounded border border-rose-300 bg-rose-50 p-4 text-xs dark:border-rose-900 dark:bg-rose-950/40">
        <p class="font-medium">The analysis could not be generated.</p>
        <p class="mt-1">{{ error }}</p>
      </div>

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

      <p v-else-if="!running && status.configured" class="text-sm text-muted-foreground">
        No analysis yet for {{ status.evidence.scope.speciesKey }} in {{ status.evidence.scope.regionKey }},
        {{ status.evidence.scope.startDate }} to {{ status.evidence.scope.endDate }}. Generate one from the evidence below.
      </p>

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
    </template>
  </div>
</template>
