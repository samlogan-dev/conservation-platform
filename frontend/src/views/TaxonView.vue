<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { portalApi } from '@/apis/portal'
import { fmt } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'
import RegionMap from '@/components/RegionMap.vue'
import TimeBars from '@/components/TimeBars.vue'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, loading, error } = useAsync(async () => {
  const [taxon, series] = await Promise.all([portalApi.taxon(id.value), portalApi.taxonSeries(id.value)])
  return { ...taxon, series }
}, [id])

const yearPoints = computed(() =>
  (data.value?.series.years ?? []).map((y) => ({ x: String(y.year), y: y.records, part: y.wild })),
)
const anyManaged = computed(() => yearPoints.value.some((p) => p.part < p.y))
const windows = computed(() => {
  const w = data.value?.series.windows
  return w
    ? [
        { from: w.baseline.start.slice(0, 4), to: w.baseline.end.slice(0, 4), label: 'baseline' },
        { from: w.recent.start.slice(0, 4), to: w.recent.end.slice(0, 4), label: 'recent' },
      ]
    : []
})
/** Regions with too few records in the two windows for a shift to mean anything stay blank. */
const MIN_REGION_RECORDS = 5
const regionShift = computed(() =>
  Object.fromEntries(
    (data.value?.series.regions ?? [])
      .filter((r) => r.baseline + r.recent >= MIN_REGION_RECORDS)
      .map((r) => [r.region, (r.recent - r.baseline) / (r.recent + r.baseline)]),
  ),
)
const silentHere = computed(() =>
  (data.value?.insights ?? []).filter((i) => i.figures.kind === 'regional_silence' && i.region).map((i) => i.region!),
)
function regionTip(name: string) {
  const r = data.value?.series.regions.find((x) => x.region === name)
  if (!r) return `${name}: no wild records since 2015`
  const quiet = silentHere.value.includes(name) ? ' — gone quiet here' : ''
  return `${name}: ${r.baseline} → ${r.recent} wild records (${r.since_2015} since 2015)${quiet}`
}
</script>

<template>
  <AsyncState :loading="loading" :error="error">
    <div v-if="data">
      <RouterLink to="/" class="text-sm text-muted-foreground hover:underline">← Report</RouterLink>
      <h1 class="mt-2 text-2xl font-semibold">{{ data.taxon.vernacular_name ?? data.taxon.scientific_name }}</h1>
      <p class="text-muted-foreground">
        <span class="italic">{{ data.taxon.scientific_name }}</span> · {{ data.taxon.national_status ?? 'status unknown' }} ·
        {{ data.taxon.family }}
      </p>
      <dl class="mt-4 grid max-w-xl grid-cols-3 gap-3 text-sm">
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Records since 2015</dt><dd class="text-lg font-semibold">{{ fmt(data.taxon.records_since_2015) }}</dd></div>
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Last record</dt><dd class="text-lg font-semibold">{{ data.taxon.last_record_day ?? '—' }}</dd></div>
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Trend insights</dt><dd class="text-lg font-semibold">{{ data.taxon.statistical_tier ? 'Yes' : 'Too few records' }}</dd></div>
      </dl>

      <section v-if="yearPoints.length" class="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 class="text-sm font-semibold">Records per year</h2>
          <TimeBars
            :points="anyManaged ? yearPoints : yearPoints.map(({ x, y }) => ({ x, y }))"
            :bands="windows"
            y-label="records"
            :part-label="anyManaged ? 'wild' : undefined"
            rest-label="managed (havens, reintroductions)"
          />
          <p class="text-xs text-muted-foreground">
            Raw counts, by date of observation: they track survey effort and loading as much as the species, and the latest
            years are still filling in.
          </p>
        </div>
        <div>
          <h2 class="text-sm font-semibold">Wild records by bioregion, baseline against recent window</h2>
          <RegionMap
            :values="regionShift"
            mode="diverging"
            :outlined="silentHere"
            :tooltip="regionTip"
            :legend="['fewer', 'more']"
            blank-label="too few records"
            :height="340"
          />
          <p class="text-xs text-muted-foreground">
            Shade: (recent − baseline) ÷ (recent + baseline) records, not effort-adjusted — the reporting-rate finding below
            is the adjusted measure. Bioregions with under {{ MIN_REGION_RECORDS }} records in the two windows are blank;
            outlined: gone quiet.
          </p>
        </div>
      </section>

      <section class="mt-8">
        <h2 class="text-lg font-semibold">Calculated findings</h2>
        <p v-if="!data.insights.length" class="text-sm text-muted-foreground">No findings for this taxon in the current report.</p>
        <ul class="divide-y"><InsightRow v-for="i in data.insights" :key="i.insight_id" :insight="i" show-type /></ul>
      </section>

      <section v-if="data.ai_insights.length" class="mt-8">
        <h2 class="text-lg font-semibold">What the AI analyst said</h2>
        <p class="text-sm text-muted-foreground">
          Insights from AI runs that name this taxon — under evaluation against the calculated findings, not part of the report.
        </p>
        <ul class="mt-2 divide-y text-sm">
          <li v-for="a in data.ai_insights" :key="a.insight_id" class="py-2">
            <RouterLink :to="`/runs/${a.run_id}`" class="text-xs text-muted-foreground hover:underline">
              {{ a.brief }} brief · {{ a.prompt_version }}{{ a.category ? ` · ${a.category}` : ` · ${a.insight_type}` }}{{ a.region ? ` · ${a.region}` : '' }}
            </RouterLink>
            <p>{{ a.summary }}</p>
          </li>
        </ul>
      </section>
    </div>
  </AsyncState>
</template>
