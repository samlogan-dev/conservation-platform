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
const baseline = useAsync(() => portalApi.baseline())
const b = computed(() => baseline.data.value?.baseline ?? null)
const perUnit = (p: Record<string, number>) =>
  Object.entries(p)
    .map(([k, v]) => `${v} ${v === 1 ? k.replace(/s$/, '') : k}`)
    .join(', ')

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
    <h1 class="text-2xl font-semibold">Evaluation</h1>
    <section v-if="b" class="mt-4">
      <h2 class="text-lg font-semibold">The platform against the manual route</h2>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
        What reproducing this month’s report by hand would take: ALA’s own search and downloads, one taxon at a time.
        A model, not a timing — each step counts the fewest queries, downloads, hand joins and calculations it needs, from
        the corpus’s own counts, and nothing for mistakes or for learning the method (model {{ b.model_version }}).
      </p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(b.totals.queries) }}</div><div class="text-xs text-muted-foreground">ALA queries</div></div>
        <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(b.totals.downloads) }}</div><div class="text-xs text-muted-foreground">record downloads</div></div>
        <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(b.totals.joins) }}</div><div class="text-xs text-muted-foreground">hand joins</div></div>
        <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(b.totals.computations) }}</div><div class="text-xs text-muted-foreground">calculations</div></div>
      </div>
      <p class="mt-2 text-sm">
        The platform: <strong>no manual steps</strong>; the calculated arm takes {{ b.platform.calculated_arm_seconds }} s.
        <template v-for="a in b.platform.ai_arm" :key="a.brief">
          The AI arm’s {{ a.brief }} brief averages {{ Math.round(a.mean_minutes) }} min and ${{ a.mean_cost.toFixed(2) }} a run
          ({{ Math.round(a.mean_queries) }} queries, {{ a.runs }} runs).
        </template>
        Even scripted, the manual route’s requests at ALA’s polite rate take at least {{ b.totals.ala_request_floor_hours }} hours.
      </p>
      <details class="mt-2 text-sm">
        <summary class="cursor-pointer text-muted-foreground">Steps and assumptions</summary>
        <div class="overflow-x-auto">
          <table class="mt-2 w-full text-xs">
            <thead class="border-b text-left text-muted-foreground">
              <tr><th class="px-2 py-1 font-medium">#</th><th class="px-2 py-1 font-medium">Step</th><th class="px-2 py-1 font-medium">Units</th><th class="px-2 py-1 font-medium">Per unit</th></tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="s in b.steps" :key="s.step">
                <td class="px-2 py-1">{{ s.insight }}</td>
                <td class="px-2 py-1">{{ s.step }}</td>
                <td class="px-2 py-1 whitespace-nowrap">{{ fmt(s.units) }} {{ s.unit }}</td>
                <td class="px-2 py-1">{{ perUnit(s.perUnit) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <h2 class="mt-10 text-lg font-semibold">The AI arm against the calculated arm</h2>
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
        <h3 class="font-semibold">{{ key }}</h3>
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
