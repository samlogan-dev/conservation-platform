<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { portalApi } from '@/apis/portal'
import { fmt } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, loading, error } = useAsync(
  async () => {
    const [run, insights] = await Promise.all([portalApi.run(id.value), portalApi.insights({ run: id.value, limit: 500 })])
    return { ...run, insights: insights.items }
  },
  [id],
)
const filter = ref('')
const shown = computed(() => (data.value?.insights ?? []).filter((i) => !filter.value || i.insight_type === filter.value))
const types = computed(() => [...new Set((data.value?.insights ?? []).map((i) => i.insight_type))])
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`)
</script>

<template>
  <AsyncState :loading="loading" :error="error">
    <div v-if="data">
      <RouterLink to="/evaluation" class="text-sm text-muted-foreground hover:underline">← Evaluation</RouterLink>
      <h1 class="mt-2 text-2xl font-semibold">
        {{ data.run.arm === 'ai' ? `AI run — ${data.run.brief} brief` : 'Calculated run' }}
        <span class="font-mono text-base text-muted-foreground">{{ data.run.run_id.slice(0, 8) }}</span>
      </h1>
      <p class="text-sm text-muted-foreground">
        {{ data.run.model ?? 'deterministic' }} · {{ data.run.prompt_version ?? `params ${data.run.params?.version}` }} ·
        {{ data.run.status }} · {{ new Date(data.run.started_at).toLocaleString('en-AU') }}
        <template v-if="data.run.usage?.turns">
          · {{ data.run.usage.turns }} turns, {{ data.run.usage.queries }} queries, ~${{ Number(data.run.usage.estimatedCostUsd).toFixed(2) }}
        </template>
      </p>

      <section v-if="data.comparison" class="mt-6 grid gap-4 md:grid-cols-3">
        <div class="rounded-lg border p-4">
          <h2 class="text-sm font-semibold">Reproduction</h2>
          <template v-if="data.comparison.summary.reproduction">
            <p class="mt-1 text-2xl font-semibold">{{ pct(data.comparison.summary.reproduction.figure_agreement) }}</p>
            <p class="text-xs text-muted-foreground">
              of figures agree · {{ data.comparison.summary.reproduction.matched }} insights matched,
              {{ data.comparison.summary.reproduction.unmatched }} unmatched
            </p>
            <ul class="mt-2 space-y-0.5 text-xs">
              <li v-for="h in data.comparison.summary.reproduction.headline_counts" :key="h.key">
                <span :class="h.agrees ? 'text-good' : 'text-alert'">{{ h.agrees ? '✓' : '✗' }}</span>
                {{ h.key.replace(':', ' · ') }}: AI {{ fmt(h.ai) }}, calculated {{ fmt(h.calculated) }}
              </li>
            </ul>
          </template>
          <p v-else class="mt-1 text-xs text-muted-foreground">Open brief — not asked to reproduce.</p>
        </div>
        <div class="rounded-lg border p-4">
          <h2 class="text-sm font-semibold">Discovery</h2>
          <p class="mt-1 text-2xl font-semibold">{{ pct(data.comparison.summary.discovery_recall_overall) }}</p>
          <p class="text-xs text-muted-foreground">of the calculated arm’s top findings surfaced</p>
          <ul class="mt-2 space-y-0.5 text-xs">
            <li v-for="(v, k) in data.comparison.summary.discovery" :key="k">{{ String(k).replaceAll('_', ' ') }}: {{ v }}</li>
          </ul>
        </div>
        <div class="rounded-lg border p-4">
          <h2 class="text-sm font-semibold">Grounding</h2>
          <p class="mt-1 text-2xl font-semibold">{{ pct(data.comparison.summary.grounding.numbers_grounded) }}</p>
          <p class="text-xs text-muted-foreground">
            of {{ fmt(data.comparison.summary.grounding.numbers) }} numbers re-run from the AI’s cited queries ·
            {{ data.comparison.summary.grounding.queries_reproduced }}/{{ data.comparison.summary.grounding.queries_cited }} queries reproduce
          </p>
          <details v-if="data.comparison.ungrounded?.length" class="mt-2 text-xs">
            <summary class="cursor-pointer">{{ data.comparison.ungrounded.length }} insights with numbers to adjudicate</summary>
            <ul class="mt-1 space-y-1">
              <li v-for="u in data.comparison.ungrounded" :key="u.insight_id">
                <span class="font-mono">{{ u.ungrounded.map((x: any) => `${x.path}=${x.value}`).join(', ') }}</span>
                — {{ u.summary.slice(0, 120) }}…
              </li>
            </ul>
          </details>
        </div>
        <p class="text-xs text-muted-foreground md:col-span-3">
          Scored by scorer {{ data.comparison.scorer_version }} against calculated run
          {{ data.comparison.calculated_run_id.slice(0, 8) }}.
        </p>
      </section>

      <section class="mt-8">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-lg font-semibold">Insights ({{ data.insights.length }})</h2>
          <select v-model="filter" class="rounded-md border bg-background px-2 py-1 text-sm">
            <option value="">All types</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <ul class="divide-y"><InsightRow v-for="i in shown" :key="i.insight_id" :insight="i" show-type /></ul>
      </section>
    </div>
  </AsyncState>
</template>
