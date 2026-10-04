<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { portalApi, type Run } from '@/apis/portal'
import { fmt } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'

/**
 * The AI arm against the calculated arm — the evaluation design in CLAUDE.md, per run: reproduction
 * (guided brief), discovery (both, mainly open) and grounding (both).
 */
const { data, loading, error } = useAsync(() => portalApi.runs())

const aiRuns = computed(() => (data.value?.runs ?? []).filter((r) => r.arm === 'ai'))
const groups = computed(() => {
  const out = new Map<string, Run[]>()
  for (const r of aiRuns.value) {
    const k = `${r.prompt_version} · ${r.brief}`
    out.set(k, [...(out.get(k) ?? []), r])
  }
  return [...out].sort((a, b) => b[0].localeCompare(a[0]))
})
const headline = (r: Run) => {
  const h = r.score?.reproduction?.headline_counts as { agrees: boolean }[] | undefined
  return h ? `${h.filter((x) => x.agrees).length}/${h.length}` : '—'
}
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`)
const cost = (r: Run) => (r.usage?.estimatedCostUsd !== undefined ? `$${Number(r.usage.estimatedCostUsd).toFixed(2)}` : '—')
const totalCost = computed(() => aiRuns.value.reduce((a, r) => a + Number(r.usage?.estimatedCostUsd ?? 0), 0))
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold">AI evaluation</h1>
    <div class="mt-2 max-w-3xl space-y-2 text-muted-foreground">
      <p>
        An AI analyst (Claude Opus 5.5) with read-only SQL access to the same database is compared with the calculated
        arm, which is the reference, not the truth. Under the <strong>guided</strong> brief it is asked for the five insights
        by definition; under the <strong>open</strong> brief it is asked only what a practitioner should know.
      </p>
      <p class="text-sm">
        <strong>Headline</strong>: headline counts matching exactly. <strong>Figures</strong>: per-taxon figures agreeing.
        <strong>Discovery</strong>: share of the calculated arm’s top findings the AI surfaced. <strong>Grounded</strong>:
        numbers that re-run from the AI’s own logged queries.
      </p>
    </div>
    <AsyncState :loading="loading" :error="error">
      <p class="mt-4 text-sm text-muted-foreground">{{ aiRuns.length }} AI runs · estimated total ${{ totalCost.toFixed(2) }}</p>
      <section v-for="[key, runs] in groups" :key="key" class="mt-6">
        <h2 class="font-semibold">{{ key }}</h2>
        <div class="overflow-x-auto">
          <table class="mt-2 w-full text-sm">
            <thead class="border-b text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-medium">Run</th>
                <th class="px-2 py-1.5 font-medium">Status</th>
                <th class="px-2 py-1.5 font-medium">Insights</th>
                <th class="px-2 py-1.5 font-medium">Headline</th>
                <th class="px-2 py-1.5 font-medium">Figures</th>
                <th class="px-2 py-1.5 font-medium">Discovery</th>
                <th class="px-2 py-1.5 font-medium">Grounded</th>
                <th class="px-2 py-1.5 font-medium">Turns</th>
                <th class="px-2 py-1.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="r in runs" :key="r.run_id" class="hover:bg-muted/50">
                <td class="px-2 py-1.5 font-mono text-xs">
                  <RouterLink :to="`/runs/${r.run_id}`" class="hover:underline">{{ r.run_id.slice(0, 8) }}</RouterLink>
                </td>
                <td class="px-2 py-1.5">{{ r.status }}</td>
                <td class="px-2 py-1.5">{{ fmt(r.insights) }}</td>
                <td class="px-2 py-1.5">{{ headline(r) }}</td>
                <td class="px-2 py-1.5">{{ pct(r.score?.reproduction?.figure_agreement) }}</td>
                <td class="px-2 py-1.5">{{ pct(r.score?.discovery_recall_overall) }}</td>
                <td class="px-2 py-1.5">{{ pct(r.score?.grounding?.numbers_grounded) }}</td>
                <td class="px-2 py-1.5">{{ r.usage?.turns ?? '—' }}</td>
                <td class="px-2 py-1.5">{{ cost(r) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AsyncState>
  </div>
</template>
