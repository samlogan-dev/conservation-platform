<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import { getSynthesisAPI, runSynthesisAPI } from '@/apis/corpusAPI'
import type { SynthesisStatus } from '@/apis/corpusTypes'
import SynthesisReport from '@/components/shared/SynthesisReport.vue'
import { num, shortHash } from '@/lib/format'

/**
 * AI analysis, console side — where the model's reading of a window is generated.
 *
 * The model is given the family's numbers as a list of named metrics — nothing per record, no
 * text, no coordinates — and asked what matters most to a practitioner. Its answer comes back
 * through a fixed schema, and the server checks every metric it cites and every number in
 * its prose against the evidence before storing it. Generating costs a model call, so it
 * lives here; the portal's AI analysis page shows the stored result and never generates one.
 */

const store = useCorpusStore()
const { harvestKey, runId } = storeToRefs(store)

const status = ref<SynthesisStatus | null>(null)
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)

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
</script>

<template>
  <div class="space-y-6 p-6">
    <p class="max-w-3xl text-xs text-muted-foreground">
      Generate the model's reading of this run's window; the portal's AI analysis page shows the
      result. The model is given the numbers below — every source for this species, region and
      window, the joins between them, and what the classifiers read in the text — and nothing
      else: no record, no remark, no coordinate. Every metric it cites and every number in its
      prose is checked against that evidence before it is stored.
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

      <p v-if="!synthesis && !running && status.configured" class="text-sm text-muted-foreground">
        No analysis yet for {{ status.evidence.scope.speciesKey }} in {{ status.evidence.scope.regionKey }},
        {{ status.evidence.scope.startDate }} to {{ status.evidence.scope.endDate }}. Generate one from the evidence below.
      </p>

      <SynthesisReport :status="status" />
    </template>
  </div>
</template>
