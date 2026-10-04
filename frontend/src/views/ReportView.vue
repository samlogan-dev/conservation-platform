<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { portalApi, type Insight, type Summary } from '@/apis/portal'
import { INSIGHT_META, MIN_TAXA_FOR_BALANCE, fmt, regionBalance } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'
import RegionMap from '@/components/RegionMap.vue'
import TimeBars from '@/components/TimeBars.vue'

/**
 * The monthly report: the five insights, each with its headline numbers and the few findings a
 * practitioner should look at first, and the caveats that decide how far each can be trusted.
 */
const { data, loading, error } = useAsync(async () => {
  const [summary, regions, currency] = await Promise.all([portalApi.summary(), portalApi.regions(), portalApi.currency()])
  const top = (q: Parameters<typeof portalApi.insights>[0]) => portalApi.insights({ limit: 5, ...q }).then((r) => r.items)
  const [silent, contraction, decline, coMovement, notable] = await Promise.all([
    top({ type: 'silent_species', label: 'silent', sort: 'baseline_annual_mean' }),
    top({ type: 'range_change', label: 'contraction', region: 'national', sort: 'aoo_change_reliable' }),
    top({ type: 'reporting_rate', label: 'decline', region: 'national', sort: 'detection_ratio' }),
    top({ type: 'co_movement', flagged: true, sort: 'p_decline', limit: 10 }),
    top({ type: 'notable_record', sort: 'distance' }),
  ])
  return { summary, regions: regions.regions, currency: currency.months, sections: { silent, contraction, decline, coMovement, notable } as Record<string, Insight[]> }
})

const count = (s: Summary, type: string, label?: string, national?: boolean) =>
  s.counts
    .filter((c) => c.insight_type === type && (label === undefined || c.label === label) && (national === undefined || c.national === national))
    .reduce((a, c) => a + c.n, 0)

const monthName = computed(() => {
  const m = data.value?.summary.run.report_month
  return m ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : ''
})
const balance = computed(() => regionBalance(data.value?.regions ?? []))
const flagged = computed(() => (data.value?.regions ?? []).filter((r) => r.co_movement?.flag).map((r) => r.region))
const balanceTip = (name: string) => {
  const cm = data.value?.regions.find((r) => r.region === name)?.co_movement
  if (!cm) return `${name}: no taxa assessed`
  const flag = cm.flag === 'co_decline' ? ' — co-decline' : cm.flag === 'co_increase' ? ' — co-increase' : ''
  return `${name}: ${cm.declines} declined, ${cm.increases} increased of ${cm.taxa_assessed} taxa${flag}`
}
const monthTick = (m: string) => (m.endsWith('-01') ? m.slice(0, 4) : '')
const currencyPoints = computed(() => (data.value?.currency ?? []).map((m) => ({ x: m.month, y: m.records })))
const yrs = (w?: { start: string; end: string }) => (w ? `${w.start.slice(0, 4)}–${w.end.slice(0, 4)}` : '')
</script>

<template>
  <AsyncState :loading="loading" :error="error">
    <template v-if="data">
      <section class="mb-8">
        <p class="text-sm font-medium text-brand">Monthly report</p>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight">Australia’s threatened species — {{ monthName }}</h1>
        <p class="mt-2 max-w-3xl text-muted-foreground">
          {{ fmt(data.summary.corpus.taxa) }} nationally listed taxa and {{ fmt(data.summary.corpus.analysable_records) }}
          occurrence records since 2015, from {{ fmt(data.summary.corpus.datasets) }} datasets aggregated by the Atlas of
          Living Australia. {{ fmt(data.summary.corpus.statistical_tier) }} taxa have enough records (100+) for the
          trend and range insights.
        </p>
      </section>

      <section class="mb-10 rounded-lg border border-warn/40 bg-warn-soft p-4 text-sm">
        <h2 class="font-semibold">Read these first</h2>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Recent months are incomplete.</strong> Datasets reach the Atlas months to a year late (eBird has not
            loaded 2026). So trends and ranges compare settled windows — {{ yrs(data.summary.run.window_baseline) }}
            against {{ yrs(data.summary.run.window_recent) }} — and only notable records and silence use the latest months.
            <div class="mt-2 rounded-md bg-background/70 p-2">
              <TimeBars
                :points="currencyPoints"
                :bands="[
                  { from: data.summary.run.window_baseline.start.slice(0, 7), to: data.summary.run.window_baseline.end.slice(0, 7), label: 'baseline window' },
                  { from: data.summary.run.window_recent.start.slice(0, 7), to: data.summary.run.window_recent.end.slice(0, 7), label: 'recent window' },
                ]"
                :x-label="monthTick"
                :height="150"
                y-label="threatened records"
              />
              <p class="text-xs text-muted-foreground">Threatened-species records per month of observation. The fall at the right is records not yet loaded, not animals.</p>
            </div>
          </li>
          <li>
            <strong>Records measure effort as well as organisms.</strong> Recording roughly doubled between the windows.
            Reporting rates are read against recording of the same group in the same places; range figures are not, so
            a contraction while effort rose is the stronger signal.
          </li>
          <li>
            <strong>Fenced havens and reintroductions are excluded</strong> from range and trend figures; every finding
            carries a data-confidence block (record counts, datasets, sources that stopped).
          </li>
        </ul>
      </section>

      <div class="space-y-10">
        <!-- #1 -->
        <section>
          <header class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">1 · {{ INSIGHT_META.silent_species.title }}</h2>
              <p class="text-sm text-muted-foreground">{{ INSIGHT_META.silent_species.question }}</p>
            </div>
            <RouterLink to="/insights/silent_species" class="text-sm underline">All findings</RouterLink>
          </header>
          <div class="mb-3 grid grid-cols-3 gap-3">
            <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(count(data.summary, 'silent_species', 'silent')) }}</div><div class="text-xs text-muted-foreground">taxa with no record in 36 months</div></div>
            <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(count(data.summary, 'silent_species', 'regional_silence')) }}</div><div class="text-xs text-muted-foreground">taxon–bioregion pairs gone quiet while recorded elsewhere</div></div>
            <div class="rounded-lg border p-3"><div class="text-2xl font-semibold">{{ fmt(count(data.summary, 'silent_species', 'evidence_gap')) }}</div><div class="text-xs text-muted-foreground">recently recorded taxa with under 10 records since 2015</div></div>
          </div>
          <p class="text-xs text-muted-foreground">Silent taxa that used to be recorded most often:</p>
          <ul class="divide-y"><InsightRow v-for="i in data.sections.silent" :key="i.insight_id" :insight="i" /></ul>
        </section>

        <!-- #2 -->
        <section>
          <header class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">2 · {{ INSIGHT_META.range_change.title }}</h2>
              <p class="text-sm text-muted-foreground">{{ INSIGHT_META.range_change.question }}</p>
            </div>
            <RouterLink to="/insights/range_change" class="text-sm underline">All taxa</RouterLink>
          </header>
          <p class="mb-2 text-sm">
            <strong>{{ count(data.summary, 'range_change', 'contraction') }}</strong> contractions and
            <strong>{{ count(data.summary, 'range_change', 'expansion') }}</strong> expansions of 30% or more in area of
            occupancy (10 km grid), {{ yrs(data.summary.run.window_baseline) }} against {{ yrs(data.summary.run.window_recent) }}.
            Steepest contractions not explained by a data source stopping:
          </p>
          <ul class="divide-y"><InsightRow v-for="i in data.sections.contraction" :key="i.insight_id" :insight="i" /></ul>
        </section>

        <!-- #3 -->
        <section>
          <header class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">3 · {{ INSIGHT_META.reporting_rate.title }}</h2>
              <p class="text-sm text-muted-foreground">{{ INSIGHT_META.reporting_rate.question }}</p>
            </div>
            <RouterLink to="/insights/reporting_rate" class="text-sm underline">All taxa</RouterLink>
          </header>
          <p class="mb-2 text-sm">
            Nationally, <strong>{{ count(data.summary, 'reporting_rate', 'decline', true) }}</strong> taxa declined and
            <strong>{{ count(data.summary, 'reporting_rate', 'increase', true) }}</strong> increased by 30% or more in the share
            of cell-months with recording of their group that recorded them (95% interval excluding no change). Steepest declines:
          </p>
          <ul class="divide-y"><InsightRow v-for="i in data.sections.decline" :key="i.insight_id" :insight="i" /></ul>
        </section>

        <!-- #4 -->
        <section>
          <header class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">4 · {{ INSIGHT_META.co_movement.title }}</h2>
              <p class="text-sm text-muted-foreground">{{ INSIGHT_META.co_movement.question }}</p>
            </div>
            <RouterLink to="/regions" class="text-sm underline">All bioregions</RouterLink>
          </header>
          <p class="mb-2 text-sm">
            Bioregions where more threatened taxa moved the same way than the national rate predicts (screening test; q
            is the false-discovery-adjusted value across bioregions):
          </p>
          <div class="mb-3 max-w-2xl">
            <RegionMap
              :values="balance"
              mode="diverging"
              :outlined="flagged"
              :tooltip="balanceTip"
              :legend="['more declines', 'more increases']"
              :height="380"
            />
            <p class="text-xs text-muted-foreground">
              Shade: reporting-rate increases minus declines, as a share of the threatened taxa assessed in each bioregion
              (blank under {{ MIN_TAXA_FOR_BALANCE }} taxa). Outlined: flagged co-movement. Click a bioregion for its findings.
            </p>
          </div>
          <ul class="divide-y"><InsightRow v-for="i in data.sections.coMovement" :key="i.insight_id" :insight="i" /></ul>
        </section>

        <!-- #5 -->
        <section>
          <header class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">5 · {{ INSIGHT_META.notable_record.title }}</h2>
              <p class="text-sm text-muted-foreground">{{ INSIGHT_META.notable_record.question }}</p>
            </div>
            <RouterLink to="/insights/notable_record" class="text-sm underline">All {{ count(data.summary, 'notable_record') }}</RouterLink>
          </header>
          <p class="mb-2 text-xs text-muted-foreground">Records to verify — a far-flung record is as often an error as a discovery. Farthest from earlier records:</p>
          <ul class="divide-y"><InsightRow v-for="i in data.sections.notable" :key="i.insight_id" :insight="i" /></ul>
        </section>
      </div>
    </template>
  </AsyncState>
</template>
