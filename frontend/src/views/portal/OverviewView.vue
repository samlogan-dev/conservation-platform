<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { usePortalStore } from '@/stores/portalStore'
import { getTimelineAPI } from '@/apis/portalAPI'
import type { RecordType, TextEvent } from '@/apis/corpusTypes'
import type { Tally, Timeline, TimelineYear } from '@/apis/portalTypes'
import YearColumns from '@/components/portal/YearColumns.vue'
import YearLines, { type LinePoint } from '@/components/portal/YearLines.vue'
import { num, pct, sourceLabel } from '@/lib/format'
import { typeColor } from '@/lib/series'

/**
 * Overview — every calendar year for a species and region, as one corpus.
 *
 * The sources are merged and de-duplicated: a sighting held by two sources is counted once,
 * and nothing on this page is split by source. It is split by record type instead, because
 * that is what changes how a figure should be read. A rescue record is about a sick animal by
 * construction; a government database's volume follows its survey programmes. So the
 * condition rate is shown per type, outside rescue records, and rescue records have their own
 * column. Which source a sighting came through stays one click away, in the console.
 */

const store = usePortalStore()
const { scope } = storeToRefs(store)

const timeline = ref<Timeline | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

watch(
  () => (scope.value ? `${scope.value.speciesKey}/${scope.value.regionKey}` : null),
  async (key) => {
    if (!key || !scope.value) return
    loading.value = true
    error.value = null
    try {
      timeline.value = await getTimelineAPI(scope.value.speciesKey, scope.value.regionKey)
    } catch (e) {
      const response = (e as { response?: { data?: { message?: string } } }).response
      error.value = response?.data?.message ?? (e instanceof Error ? e.message : String(e))
      timeline.value = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const years = computed(() => timeline.value?.years ?? [])
const yearList = computed(() => years.value.map((y) => y.year))
const typeLabel = (t: RecordType) => timeline.value?.recordTypes[t]?.label ?? t

/** Below this many remarks a year, a rate is drawn hollow and read with care. */
const SMALL_SAMPLE = 30

const harmOf = (t: Tally) => t.byCondition.dead + t.byCondition.alive_unwell

/** Every type but rescue: the "wild" sightings, where a harm rate means something. */
const NOT_RESCUE: RecordType[] = ['government_database', 'public_sighting', 'survey_research', 'specimen', 'other']
const sumTallies = (y: TimelineYear, types: RecordType[]) =>
  types.reduce(
    (acc, t) => {
      const x = y.union.byType[t]
      acc.read += x.remarksRead
      acc.harm += harmOf(x)
      return acc
    },
    { read: 0, harm: 0 },
  )

/** Sources other than the largest: the ones whose unique sightings show what joining adds. */
const addingSources = computed(() => {
  const totals = new Map<string, number>()
  for (const y of years.value) for (const s of y.union.sources) totals.set(s.source, (totals.get(s.source) ?? 0) + s.records)
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(1).map(([source]) => source)
})
const onlyIn = (y: TimelineYear, source: string) => y.union.sources.find((s) => s.source === source)?.onlyHere ?? 0

// ---- Sightings per year: all of them, then one panel per main channel, each on its own scale.
const PANEL_TYPES: RecordType[] = ['government_database', 'public_sighting', 'rescue_rehab']
const panels = computed(() => [
  {
    key: 'all',
    label: 'All distinct sightings',
    color: typeColor('all'),
    points: years.value.map((y) => ({
      year: y.year,
      value: y.union.distinct,
      partial: y.inProgress,
      note: y.union.duplicatesRemoved ? `${num(y.union.duplicatesRemoved)} copies held by two sources counted once` : undefined,
    })),
  },
  ...PANEL_TYPES.map((t) => ({
    key: t,
    label: typeLabel(t),
    color: typeColor(t),
    points: years.value.map((y) => ({ year: y.year, value: y.union.byType[t].records, partial: y.inProgress })),
  })),
])

// ---- Condition, outside rescue records, per kind of record.
const harmSeries = computed(() => {
  const series = (['government_database', 'public_sighting'] as RecordType[]).map((t) => ({
    key: t,
    label: typeLabel(t),
    color: typeColor(t),
    points: years.value.map((y): LinePoint => {
      const x = y.union.byType[t]
      return x.remarksRead
        ? { year: y.year, value: harmOf(x) / x.remarksRead, n: x.remarksRead, weak: x.remarksRead < SMALL_SAMPLE }
        : { year: y.year, value: null, n: 0, weak: true }
    }),
  }))
  // No combined line: government records are nine in ten of the rest, so it would sit on
  // the government line and say nothing the headline figure does not.
  return series
})

// ---- Threats named in remarks, across every distinct sighting.
const THREATS: { key: TextEvent; label: string }[] = [
  { key: 'vehicle_strike', label: 'Vehicle strike' },
  { key: 'dog_attack', label: 'Dog attack' },
  { key: 'disease', label: 'Disease' },
  { key: 'injury', label: 'Injury' },
  { key: 'fire', label: 'Fire' },
]

const threatRows = computed(() =>
  years.value.map((y) => {
    const rescue = y.union.byType.rescue_rehab
    return {
      year: y.year,
      windowId: y.windowId,
      inProgress: y.inProgress,
      rescue: rescue.records,
      read: y.union.total.remarksRead,
      dead: y.union.total.byCondition.dead,
      counts: Object.fromEntries(THREATS.map((t) => [t.key, y.union.total.byEvent[t.key]])) as Record<TextEvent, number>,
      inRescue: Object.fromEntries(THREATS.map((t) => [t.key, rescue.byEvent[t.key]])) as Record<TextEvent, number>,
    }
  }),
)

/** The largest count in each threat column, so each column's shading reads on its own scale. */
const threatMax = computed(() =>
  Object.fromEntries(THREATS.map((t) => [t.key, Math.max(1, ...threatRows.value.map((r) => r.counts[t.key]))])) as Record<TextEvent, number>,
)

// ---- Headline figures: the most recent calendar year that has finished.
const latest = computed(() => [...years.value].reverse().find((y) => !y.inProgress) ?? null)
const headline = computed(() => {
  const y = latest.value
  if (!y) return null
  const wild = sumTallies(y, NOT_RESCUE)
  const top = [...THREATS].sort((a, b) => y.union.total.byEvent[b.key] - y.union.total.byEvent[a.key])[0]!
  return {
    year: y.year,
    windowId: y.windowId,
    distinct: y.union.distinct,
    duplicates: y.union.duplicatesRemoved,
    rescue: y.union.byType.rescue_rehab.records,
    wildShare: wild.read ? wild.harm / wild.read : 0,
    wild,
    top,
    topCount: y.union.total.byEvent[top.key],
    topInRescue: y.union.byType.rescue_rehab.byEvent[top.key],
    adds: addingSources.value.map((s) => ({ source: s, only: onlyIn(y, s) })).filter((a) => a.only > 0),
  }
})

const classifierNote = computed(() => {
  const c = timeline.value?.classifier
  if (!c) return 'No single classifier has read every year, so condition and threat figures are not shown.'
  if (c.classifier === 'llm') return `Remarks were read by ${c.model ?? 'the language model'}, the same classifier for every year.`
  return 'Remarks were read by the keyword baseline, the one classifier that has read every year, so a change across years is not a change of classifier.'
})

const yearLink = (windowId: string) => ({ path: '/sources', query: { window: windowId } })
const TABLE_TYPES: RecordType[] = ['government_database', 'public_sighting', 'rescue_rehab', 'survey_research', 'specimen']
</script>

<template>
  <div class="space-y-10 p-6">
    <p v-if="loading && !timeline" class="text-sm text-muted-foreground">
      Loading every year… the first visit after a new harvest merges that year's sources, which can take a few seconds.
    </p>
    <div v-else-if="error" class="rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
      <p class="font-medium">Could not load the overview.</p>
      <p class="mt-1 text-xs">{{ error }}</p>
    </div>

    <template v-else-if="timeline && years.length">
      <p class="max-w-3xl text-xs text-muted-foreground">
        {{ timeline.vernacularName }} sightings in {{ timeline.regionLabel }}, {{ years[0]!.year }} to
        {{ years[years.length - 1]!.year }}, every source merged into one record: a sighting held by more
        than one source is counted once. Counts are records, not animals. Where it changes how a figure
        should be read, it is split by the kind of record — a rescue, a government survey, a member of the
        public — rather than by where it was fetched from.
      </p>

      <!-- Headline: the most recent full year -->
      <section v-if="headline">
        <h2 class="text-base font-semibold">
          {{ headline.year }}, the most recent full year
          <RouterLink :to="yearLink(headline.windowId)" class="ml-2 text-xs font-normal text-muted-foreground underline decoration-dotted hover:text-foreground">open {{ headline.year }} →</RouterLink>
        </h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded border border-border p-4">
            <p class="text-xs text-muted-foreground">Distinct sightings</p>
            <p class="mt-1 text-2xl font-semibold">{{ num(headline.distinct) }}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">{{ num(headline.duplicates) }} held by two sources, counted once</p>
          </div>
          <div class="rounded border border-border p-4">
            <p class="text-xs text-muted-foreground">Came into care</p>
            <p class="mt-1 text-2xl font-semibold">{{ num(headline.rescue) }}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">rescue and rehabilitation records</p>
          </div>
          <div class="rounded border border-border p-4">
            <p class="text-xs text-muted-foreground">Other sightings describing a sick, injured or dead koala</p>
            <p class="mt-1 text-2xl font-semibold">{{ pct(headline.wildShare) }}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">{{ num(headline.wild.harm) }} of {{ num(headline.wild.read) }} remarks, outside rescue records</p>
          </div>
          <div class="rounded border border-border p-4">
            <p class="text-xs text-muted-foreground">Threat named most</p>
            <p class="mt-1 text-2xl font-semibold">{{ headline.top.label }}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">{{ num(headline.topCount) }} remarks, {{ num(headline.topInRescue) }} of them rescue records</p>
          </div>
        </div>
        <p v-for="a in headline.adds" :key="a.source" class="mt-3 max-w-3xl text-xs">
          <span class="font-medium">What joining the sources adds:</span>
          {{ num(a.only) }} of {{ headline.year }}'s sightings are held only by {{ sourceLabel(a.source) }}. A reader
          working from the largest source alone would not see them.
        </p>
      </section>

      <!-- Sightings per year -->
      <section>
        <h2 class="text-base font-semibold">Sightings per year</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Every distinct sighting, then the three main kinds of record, each panel on its own scale.
          Government records follow survey effort: the 2023–24 jump is monitoring programmes (acoustic
          recorders, drone surveys) loading their data, not more koalas. Rescue records arrive late, so the
          most recent years undercount them. A faded column is a year still in progress.
        </p>
        <div class="mt-4 grid gap-6 lg:grid-cols-2">
          <YearColumns v-for="p in panels" :key="p.key" :label="p.label" :color="p.color" :points="p.points" />
        </div>
      </section>

      <!-- Condition -->
      <section v-if="timeline.classifier">
        <h2 class="text-base font-semibold">Remarks describing a sick, injured or dead koala</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Of the remarks about a koala each year, the share that describe it unwell or dead — outside rescue
          records, which describe animals in care by construction and would make this a measure of how much
          rehabilitation data was loaded. A hollow point rests on fewer than {{ SMALL_SAMPLE }} remarks.
          {{ classifierNote }}
        </p>
        <div class="mt-4 max-w-4xl">
          <YearLines :years="yearList" :series="harmSeries" n-label="remarks read" />
        </div>
      </section>

      <!-- Threats -->
      <section v-if="timeline.classifier">
        <h2 class="text-base font-semibold">Threats named in remarks</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Remarks naming each threat, across every distinct sighting. Most come from rescue records, so they
          rise and fall with how much rehabilitation data has arrived; hover a cell for the split. Named only
          where the text states it: a road nearby is not a strike. Shading is per column, darkest at that
          threat's busiest year.
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[48rem] text-xs">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Year</th>
                <th class="px-3 py-2 text-right font-medium">Came into care</th>
                <th class="px-3 py-2 text-right font-medium">Remarks read</th>
                <th class="px-3 py-2 text-right font-medium">Dead</th>
                <th v-for="t in THREATS" :key="t.key" class="px-3 py-2 text-right font-medium">{{ t.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in threatRows" :key="r.year" class="border-t border-border">
                <td class="px-3 py-1.5">
                  <RouterLink :to="yearLink(r.windowId)" class="underline decoration-dotted hover:text-foreground">{{ r.year }}</RouterLink>
                  <span v-if="r.inProgress" class="ml-1 text-[11px] text-amber-700 dark:text-amber-400">partial</span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(r.rescue) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(r.read) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(r.dead) }}</td>
                <td
                  v-for="t in THREATS"
                  :key="t.key"
                  class="px-3 py-1.5 text-right font-mono"
                  :style="{ background: `color-mix(in oklab, var(--foreground) ${Math.round((r.counts[t.key] / threatMax[t.key]) * 14)}%, transparent)` }"
                  :title="`${t.label}, ${r.year}: ${num(r.counts[t.key])} remarks — ${num(r.inRescue[t.key])} in rescue records, ${num(r.counts[t.key] - r.inRescue[t.key])} in other sightings`"
                >{{ num(r.counts[t.key]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Year by year -->
      <section>
        <h2 class="text-base font-semibold">Year by year</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Every figure behind the charts. <em>Counted once</em> is sightings held by two sources.
          <em>Obscured</em> is locations deliberately blurred beyond 10 km — a privacy measure for a
          threatened species, not an error. <em>Passes schema</em> is records with every required field
          present and well-formed. <em>Complete</em> means every source returned every record it reported.
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[64rem] text-xs [&_td]:whitespace-nowrap">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Year</th>
                <th class="px-3 py-2 text-right font-medium">Distinct sightings</th>
                <th class="px-3 py-2 text-right font-medium">Counted once</th>
                <th v-for="s in addingSources" :key="s" class="px-3 py-2 text-right font-medium">Only in {{ sourceLabel(s) }}</th>
                <th v-for="t in TABLE_TYPES" :key="t" class="px-3 py-2 text-right font-medium">
                  <span class="mr-1 inline-block h-2 w-2 rounded-sm align-middle" :style="{ background: typeColor(t) }" />{{ typeLabel(t) }}
                </th>
                <th class="px-3 py-2 text-right font-medium">Obscured</th>
                <th class="px-3 py-2 text-right font-medium">Passes schema</th>
                <th class="px-3 py-2 text-right font-medium">Complete</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="y in [...years].reverse()" :key="y.year" class="border-t border-border">
                <td class="px-3 py-1.5">
                  {{ y.year }}
                  <span v-if="y.inProgress" class="ml-1 text-[11px] text-amber-700 dark:text-amber-400">partial</span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(y.union.distinct) }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{{ num(y.union.duplicatesRemoved) }}</td>
                <td v-for="s in addingSources" :key="s" class="px-3 py-1.5 text-right font-mono">{{ num(onlyIn(y, s)) }}</td>
                <td v-for="t in TABLE_TYPES" :key="t" class="px-3 py-1.5 text-right font-mono" :class="y.union.byType[t].records ? '' : 'text-muted-foreground'">
                  {{ num(y.union.byType[t].records) }}
                </td>
                <td class="px-3 py-1.5 text-right font-mono">
                  {{ num(y.union.total.obscured) }}
                  <span class="text-muted-foreground">({{ pct(y.union.distinct ? y.union.total.obscured / y.union.distinct : 0, 0) }})</span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono" :class="y.union.total.valid < y.union.distinct ? 'text-amber-700 dark:text-amber-400' : ''">
                  {{ pct(y.union.distinct ? y.union.total.valid / y.union.distinct : 1, y.union.total.valid < y.union.distinct ? 1 : 0) }}
                </td>
                <td class="px-3 py-1.5 text-right" :class="y.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                  {{ y.complete ? '✓' : '✗' }}
                </td>
                <td class="px-3 py-1.5 text-right">
                  <RouterLink :to="yearLink(y.windowId)" class="text-muted-foreground underline decoration-dotted hover:text-foreground">open {{ y.year }} →</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
