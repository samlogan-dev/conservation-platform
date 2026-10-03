<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePortalStore } from '@/stores/portalStore'
import { getWindowUnionAPI } from '@/apis/portalAPI'
import type { RecordType, TextEvent } from '@/apis/corpusTypes'
import type { Tally, WindowUnion } from '@/apis/portalTypes'
import CoverageBar from '@/components/corpus/CoverageBar.vue'
import { num, pct, sourceLabel } from '@/lib/format'
import { typeColor } from '@/lib/series'

/**
 * Sources — where the window's sightings come from, read as one corpus.
 *
 * The sources are merged first: a sighting two sources both hold is counted once. Then the
 * page answers what a reader needs before trusting a figure: what the join added, what kinds
 * of record the corpus is made of and how each reads, which datasets supplied it, and the
 * quality flags it carries. Flags are shown, never used to hide a record. How each source was
 * fetched, and how the sources compare to each other, is the console's business.
 */

const store = usePortalStore()
const { windowId, family } = storeToRefs(store)

const data = ref<WindowUnion | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

watch(
  windowId,
  async (id) => {
    if (!id) return
    loading.value = true
    error.value = null
    try {
      const d = await getWindowUnionAPI(id)
      if (windowId.value === id) data.value = d
    } catch (e) {
      const response = (e as { response?: { data?: { message?: string } } }).response
      error.value = response?.data?.message ?? (e instanceof Error ? e.message : String(e))
      data.value = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const union = computed(() => data.value?.union ?? null)
const typeLabel = (t: RecordType) => data.value?.recordTypes[t]?.label ?? t

const EVENT_LABEL: Record<TextEvent, string> = {
  vehicle_strike: 'vehicle strike',
  dog_attack: 'dog attack',
  disease: 'disease',
  injury: 'injury',
  fire: 'fire',
  rescue_or_care: 'rescue or care',
  with_joey: 'with joey',
}
const THREAT_KEYS: TextEvent[] = ['vehicle_strike', 'dog_attack', 'disease', 'injury', 'fire']

const harmOf = (t: Tally) => t.byCondition.dead + t.byCondition.alive_unwell

/** The source with the most records first; the rest are what the join added. */
const sources = computed(() => [...(union.value?.sources ?? [])].sort((a, b) => b.records - a.records))

const typeRows = computed(() => {
  const u = union.value
  if (!u || !data.value) return []
  return (Object.keys(data.value.recordTypes) as RecordType[])
    .map((t) => {
      const x = u.byType[t]
      const threats = THREAT_KEYS.filter((e) => x.byEvent[e] > 0)
        .sort((a, b) => x.byEvent[b] - x.byEvent[a])
        .slice(0, 3)
        .map((e) => `${EVENT_LABEL[e]} ${num(x.byEvent[e])}`)
      return { type: t, info: data.value!.recordTypes[t], x, threats }
    })
    .filter((r) => r.x.records > 0)
})

const maxDataset = computed(() => Math.max(1, ...(union.value?.byDataset.map((d) => d.records) ?? [1])))

/** A dataset's kinds of record, largest first, as "Rescue & rehab 424 · Government database 10,342". */
const datasetTypes = (byType: Partial<Record<RecordType, number>>) =>
  (Object.entries(byType) as [RecordType, number][]).sort((a, b) => b[1] - a[1])

const members = computed(() => family.value?.members ?? [])
</script>

<template>
  <div class="space-y-10 p-6">
    <p v-if="loading && !data" class="text-sm text-muted-foreground">Merging the sources…</p>
    <div v-else-if="error" class="rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
      <p class="font-medium">Could not load this window's sightings.</p>
      <p class="mt-1 text-xs">{{ error }}</p>
    </div>

    <template v-else-if="union && data">
      <p class="max-w-3xl text-xs text-muted-foreground">
        Every source for this window, merged: <span class="font-mono text-foreground">{{ num(union.distinct) }}</span>
        distinct sightings, with {{ num(union.duplicatesRemoved) }} sightings that two sources both hold counted once.
        Counts are records, not animals.
      </p>

      <!-- What the join adds -->
      <section>
        <h2 class="text-base font-semibold">What joining the sources adds</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          The same sighting can reach this platform through more than one source. Sightings are matched on
          the publisher's own identifier, and a match is kept once, in the copy from where it was first recorded.
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[36rem] text-xs">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Source</th>
                <th class="px-3 py-2 text-right font-medium">Sightings it holds</th>
                <th class="px-3 py-2 text-right font-medium">Also held by another source</th>
                <th class="px-3 py-2 text-right font-medium">Only here</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in sources" :key="s.harvestKey" class="border-t border-border">
                <td class="px-3 py-1.5">{{ sourceLabel(s.source) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(s.records) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(s.shared) }}</td>
                <td class="px-3 py-1.5 text-right font-mono" :class="i > 0 && s.onlyHere ? 'font-semibold' : ''">{{ num(s.onlyHere) }}</td>
              </tr>
              <tr class="border-t border-border bg-muted/30 font-medium">
                <td class="px-3 py-1.5">Distinct sightings</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(union.distinct) }}</td>
                <td class="px-3 py-1.5" colspan="2" />
              </tr>
            </tbody>
          </table>
        </div>
        <p v-for="s in sources.slice(1).filter((x) => x.onlyHere > 0)" :key="s.source" class="mt-2 max-w-3xl text-xs">
          {{ num(s.onlyHere) }} sightings are held only by {{ sourceLabel(s.source) }}. A reader working from
          {{ sourceLabel(sources[0]!.source) }} alone would not see them.
        </p>
      </section>

      <!-- Kinds of record -->
      <section>
        <h2 class="text-base font-semibold">Kinds of record</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          What the corpus is made of, by how each record was made. This decides how a figure should be read:
          a rescue record is about a sick or injured animal by construction, and a government database's volume
          follows its survey programmes. <span v-if="data.classifier">Remarks were read by
          {{ data.classifier.classifier === 'llm' ? data.classifier.model : 'the keyword baseline' }}.</span>
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[60rem] text-xs">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Kind</th>
                <th class="w-40 px-3 py-2 font-medium">Sightings</th>
                <th class="px-3 py-2 text-right font-medium">Share</th>
                <th class="px-3 py-2 text-right font-medium">Remarks read</th>
                <th class="px-3 py-2 text-right font-medium">Sick, injured or dead</th>
                <th class="px-3 py-2 font-medium">Threats named most</th>
                <th class="px-3 py-2 text-right font-medium">Obscured</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in typeRows" :key="r.type" class="border-t border-border align-top">
                <td class="max-w-xs px-3 py-1.5">
                  <span class="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" :style="{ background: typeColor(r.type) }" />
                  <span class="font-medium">{{ r.info.label }}</span>
                  <p class="mt-0.5 text-[11px] text-muted-foreground">{{ r.info.description }}</p>
                </td>
                <td class="px-3 py-1.5">
                  <div class="flex items-center gap-2">
                    <CoverageBar :value="r.x.records / Math.max(1, union.distinct)" />
                    <span class="w-14 shrink-0 text-right font-mono">{{ num(r.x.records) }}</span>
                  </div>
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{{ pct(r.x.records / Math.max(1, union.distinct)) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(r.x.remarksRead) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">
                  <template v-if="r.x.remarksRead">
                    {{ pct(harmOf(r.x) / r.x.remarksRead) }}
                    <span class="text-muted-foreground">({{ num(harmOf(r.x)) }})</span>
                  </template>
                  <span v-else class="text-muted-foreground">no remarks</span>
                </td>
                <td class="px-3 py-1.5 text-muted-foreground">{{ r.threats.join(' · ') || '—' }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(r.x.obscured) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Datasets -->
      <section>
        <h2 class="text-base font-semibold">Who supplied the sightings</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Every contributing dataset, largest first, counted after sightings held twice were merged — so a dataset
          that republishes another source's sightings shows only the ones that source did not have itself.
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[48rem] text-xs">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Dataset</th>
                <th class="w-40 px-3 py-2 font-medium">Sightings</th>
                <th class="px-3 py-2 text-right font-medium">Share</th>
                <th class="px-3 py-2 font-medium">Kinds of record</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in union.byDataset" :key="d.dataResourceUid ?? d.dataResourceName" class="border-t border-border">
                <td class="px-3 py-1.5">
                  {{ d.dataResourceName }}
                  <span class="ml-1 font-mono text-[11px] text-muted-foreground">{{ d.dataResourceUid }}</span>
                </td>
                <td class="px-3 py-1.5">
                  <div class="flex items-center gap-2">
                    <CoverageBar :value="d.records / maxDataset" />
                    <span class="w-14 shrink-0 text-right font-mono">{{ num(d.records) }}</span>
                  </div>
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{{ pct(d.records / Math.max(1, union.distinct)) }}</td>
                <td class="px-3 py-1.5">
                  <span v-for="[t, n] in datasetTypes(d.byType)" :key="t" class="mr-3 whitespace-nowrap">
                    <span class="mr-1 inline-block h-2 w-2 rounded-sm align-middle" :style="{ background: typeColor(t) }" />{{ typeLabel(t) }}
                    <span class="font-mono text-muted-foreground">{{ num(n) }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Quality flags -->
      <section v-if="members.length">
        <h2 class="text-base font-semibold">Quality flags on the records</h2>
        <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
          Flags carried on the records as received: a source's own data-quality assertions, or for sources without
          any, the ones derived from the record's own fields. Each source has its own vocabulary, so they are listed
          per source rather than added up. A flag never removes a sighting from the counts above.
        </p>
        <div class="mt-4 grid gap-6 lg:grid-cols-2">
          <div v-for="m in members" :key="m.harvestKey" class="min-w-0">
            <h3 class="text-sm">{{ sourceLabel(m.source) }}</h3>
            <ul v-if="m.analysis.sourceAssertions.length" class="mt-2 space-y-1 text-xs">
              <li v-for="a in m.analysis.sourceAssertions.slice(0, 12)" :key="a.assertion" class="flex items-center gap-2">
                <span class="w-12 shrink-0 text-right font-mono">{{ num(a.count) }}</span>
                <span class="w-10 shrink-0 text-right font-mono text-muted-foreground">{{ pct(a.share, 0) }}</span>
                <span class="min-w-0 flex-1"><CoverageBar :value="a.share" /></span>
                <span class="w-56 shrink-0 truncate font-mono" :title="a.assertion">{{ a.assertion }}</span>
              </li>
            </ul>
            <p v-else class="mt-2 text-xs text-muted-foreground">No flags on any record.</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
