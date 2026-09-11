<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import CoverageBar from '@/components/corpus/CoverageBar.vue'
import type { TextBand } from '@/apis/corpusTypes'
import { bytes, num, pct, sourceLabel } from '@/lib/format'

/**
 * Page 3 — the numbers across every source, described and not interpreted.
 *
 * Reads the family (every source fetched for the same species, region and window) rather
 * than the selected run, so it says the same thing whichever source is selected above. One
 * row per source where sources are compared; one combined figure where they are added up.
 * What the figures mean is page 4's job; one source's own detail is on page 2.
 */

const store = useCorpusStore()
const { family } = storeToRefs(store)

const members = computed(() => family.value?.members ?? [])
const comparisons = computed(() => family.value?.comparisons ?? [])

const BANDS = ['substantive', 'short', 'trivial', 'absent'] as const
const BAND_CLASS: Record<string, string> = {
  substantive: 'bg-emerald-500',
  short: 'bg-sky-400',
  trivial: 'bg-amber-400',
  absent: 'bg-neutral-300 dark:bg-neutral-700',
}

/** One overview row per source. */
const sourceRows = computed(() =>
  members.value.map((m) => {
    const remarks = m.analysis.freeText.find((f) => f.canonicalField === 'occurrenceRemarks')
    return {
      key: m.harvestKey,
      source: m.source,
      harvestKey: m.harvestKey,
      runId: m.runId,
      retrieved: m.manifest.retrievedRecords,
      expected: m.manifest.expectedRecords,
      complete: m.manifest.complete,
      datasets: m.analysis.resources.length,
      substantiveShare: remarks?.substantiveShare ?? 0,
      obscured: m.analysis.resources.reduce((sum, r) => sum + r.obscuredRecords, 0),
      calls: m.manifest.requestCount,
      frozen: m.manifest.pages.reduce((sum, p) => sum + p.bytes, 0),
    }
  }),
)

const totalRecords = computed(() => sourceRows.value.reduce((sum, r) => sum + r.retrieved, 0))

/**
 * Sightings by source. Each side is its whole corpus, not the namespace-scoped count the join
 * works on, because the question here is "how many does each source hold" rather than "how
 * well do they overlap". Matched sightings are counted once in the distinct total.
 */
const bySource = computed(() =>
  comparisons.value.map((c) => ({
    key: `${c.left.harvestKey}-${c.right.harvestKey}`,
    matched: c.matched,
    distinct: c.left.corpusRecords + c.right.corpusRecords - c.matched,
    sides: [c.left, c.right].map((s) => ({
      source: s.source,
      harvestKey: s.harvestKey,
      records: s.corpusRecords,
      only: s.corpusRecords - c.matched,
    })),
  })),
)

/** Every contributing dataset across every source, largest first. */
const datasets = computed(() =>
  members.value
    .flatMap((m) => m.analysis.resources.map((r) => ({ source: m.source, ...r })))
    .sort((a, b) => b.records - a.records),
)
const maxDatasetRecords = computed(() => Math.max(1, ...datasets.value.map((d) => d.records)))

/** What the text says: one row per source and classifier that has read it. */
const textRows = computed(() =>
  members.value.flatMap((m) => m.text.map((t) => ({ source: m.source, t }))),
)
const TEXT_EVENTS = ['vehicle_strike', 'dog_attack', 'disease', 'injury', 'fire', 'rescue_or_care', 'with_joey'] as const

/** Free text per field: one row per source and a combined row. */
const textFields = computed(() => {
  const fields = [...new Set(members.value.flatMap((m) => m.analysis.freeText.map((f) => f.canonicalField)))]
  return fields.map((field) => {
    const rows = members.value.flatMap((m) => {
      const f = m.analysis.freeText.find((x) => x.canonicalField === field)
      return f ? [{ label: sourceLabel(m.source), total: f.total, bands: f.bands, median: f.medianLength }] : []
    })
    const combined = {
      label: 'all sources',
      total: rows.reduce((sum, r) => sum + r.total, 0),
      bands: Object.fromEntries(
        BANDS.map((b) => [b, rows.reduce((sum, r) => sum + r.bands[b], 0)]),
      ) as Record<TextBand, number>,
      median: null as number | null,
    }
    return { field, rows: rows.length > 1 ? [...rows, combined] : rows }
  })
})
</script>

<template>
  <div v-if="family" class="space-y-10 p-6">
    <!-- Sources -->
    <section>
      <h2 class="text-base font-semibold">Sources</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        Every source fetched for {{ family.speciesKey }} in {{ family.regionKey }},
        {{ family.startDate }} to {{ family.endDate }}: one row each, newest run of each. The
        detail behind a row is on the Schema page, under "About this source".
      </p>

      <div class="mt-4 overflow-x-auto rounded border border-border">
        <table class="w-full min-w-[60rem] text-xs">
          <thead class="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Source</th>
              <th class="px-3 py-2 text-right font-medium">Records</th>
              <th class="px-3 py-2 text-right font-medium">Complete</th>
              <th class="px-3 py-2 text-right font-medium">Datasets</th>
              <th class="px-3 py-2 text-right font-medium">Substantive text</th>
              <th class="px-3 py-2 text-right font-medium">Obscured &gt;10 km</th>
              <th class="px-3 py-2 text-right font-medium">API calls</th>
              <th class="px-3 py-2 text-right font-medium">Frozen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sourceRows" :key="r.key" class="border-t border-border">
              <td class="px-3 py-1.5">
                <span class="font-mono">{{ r.source }}</span>
                <span class="ml-2 font-mono text-[11px] text-muted-foreground" :title="r.runId">{{ r.harvestKey }}</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">
                {{ num(r.retrieved) }}
                <span class="text-muted-foreground">/ {{ num(r.expected) }}</span>
              </td>
              <td class="px-3 py-1.5 text-right" :class="r.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                {{ r.complete ? '✓' : '✗' }}
              </td>
              <td class="px-3 py-1.5 text-right font-mono">{{ r.datasets }}</td>
              <td class="px-3 py-1.5 text-right font-mono">{{ pct(r.substantiveShare) }}</td>
              <td class="px-3 py-1.5 text-right font-mono" :class="r.obscured ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'">
                {{ num(r.obscured) }}
                <span class="text-muted-foreground">({{ pct(r.retrieved ? r.obscured / r.retrieved : 0, 0) }})</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">{{ num(r.calls) }}</td>
              <td class="px-3 py-1.5 text-right font-mono">{{ bytes(r.frozen) }}</td>
            </tr>
            <tr v-if="sourceRows.length > 1" class="border-t border-border bg-muted/30 font-medium">
              <td class="px-3 py-1.5">All sources, before de-duplication</td>
              <td class="px-3 py-1.5 text-right font-mono">{{ num(totalRecords) }}</td>
              <td class="px-3 py-1.5" colspan="6" />
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Sightings by source -->
    <section>
      <h2 class="text-base font-semibold">Sightings by source</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        The same observation can arrive through more than one source. Rows are matched on the
        publisher's observation id, and a matched sighting is counted once in the distinct total.
      </p>

      <template v-if="bySource.length">
        <div v-for="group in bySource" :key="group.key" class="mt-4 overflow-x-auto rounded border border-border">
          <table class="w-full min-w-[36rem] text-xs">
            <thead class="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Source</th>
                <th class="px-3 py-2 text-right font-medium">Records</th>
                <th class="px-3 py-2 text-right font-medium">Only in this source</th>
                <th class="px-3 py-2 text-right font-medium">In both</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in group.sides" :key="s.source" class="border-t border-border">
                <td class="px-3 py-1.5">
                  <span class="font-mono">{{ s.source }}</span>
                  <span class="ml-2 font-mono text-[11px] text-muted-foreground">{{ s.harvestKey }}</span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(s.records) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(s.only) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(group.matched) }}</td>
              </tr>
              <tr class="border-t border-border bg-muted/30 font-medium">
                <td class="px-3 py-1.5">Distinct sightings across both</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ num(group.distinct) }}</td>
                <td class="px-3 py-1.5" colspan="2" />
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="mt-3 text-xs text-muted-foreground">
        Only one source covers this species, region and window. Distinct sightings:
        <span class="font-mono text-foreground">{{ num(totalRecords) }}</span>.
      </p>
    </section>

    <!-- Where the records came from -->
    <section>
      <h2 class="text-base font-semibold">Where the records came from</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        Every contributing dataset across every source, largest first. An aggregator carries
        many; a primary source is its own single dataset. Location precision is the median
        uncertainty each dataset reports, and how many of its records are obscured beyond 10 km.
      </p>

      <div class="mt-4 overflow-x-auto rounded border border-border">
        <table class="w-full min-w-[60rem] text-xs">
          <thead class="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Source</th>
              <th class="px-3 py-2 font-medium">Dataset</th>
              <th class="w-40 px-3 py-2 font-medium">Records</th>
              <th class="px-3 py-2 text-right font-medium">Share of source</th>
              <th class="px-3 py-2 text-right font-medium">Substantive text</th>
              <th class="px-3 py-2 text-right font-medium">Median uncertainty</th>
              <th class="px-3 py-2 text-right font-medium">Obscured &gt;10 km</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in datasets" :key="`${d.source}-${d.dataResourceUid ?? d.dataResourceName}`" class="border-t border-border">
              <td class="px-3 py-1.5 font-mono">{{ d.source }}</td>
              <td class="px-3 py-1.5">
                {{ d.dataResourceName }}
                <span class="ml-1 font-mono text-[11px] text-muted-foreground">{{ d.dataResourceUid }}</span>
              </td>
              <td class="px-3 py-1.5">
                <div class="flex items-center gap-2">
                  <CoverageBar :value="d.records / maxDatasetRecords" />
                  <span class="w-12 shrink-0 text-right font-mono">{{ num(d.records) }}</span>
                </div>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">{{ pct(d.share) }}</td>
              <td class="px-3 py-1.5 text-right font-mono">
                {{ num(d.substantiveRemarks) }}
                <span class="text-muted-foreground">({{ pct(d.records ? d.substantiveRemarks / d.records : 0, 0) }})</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">
                <template v-if="d.medianCoordinateUncertainty !== null">{{ num(Math.round(d.medianCoordinateUncertainty)) }} m</template>
                <span v-else class="text-muted-foreground">not supplied</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono" :class="d.obscuredRecords ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'">
                {{ num(d.obscuredRecords) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Free text -->
    <section>
      <h2 class="text-base font-semibold">Free text</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        How much of each text field is populated, per source, and with what. <em>Trivial</em>
        has no word of two or more letters ("0", ", K2"). <em>Short</em> is under 20 characters
        or fewer than three words. <em>Substantive</em> is everything above that.
      </p>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <article v-for="tf in textFields" :key="tf.field" class="min-w-0 rounded border border-border p-4">
          <h3 class="font-mono text-sm">{{ tf.field }}</h3>
          <div class="mt-3 space-y-3">
            <div v-for="row in tf.rows" :key="row.label" :class="row.label === 'all sources' ? 'border-t border-border pt-3' : ''">
              <div class="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span :class="row.label === 'all sources' ? 'font-medium' : ''">{{ row.label }}</span>
                <span class="text-muted-foreground">
                  <span class="font-mono text-foreground">{{ pct(row.total ? row.bands.substantive / row.total : 0) }}</span>
                  substantive of {{ num(row.total) }}<template v-if="row.median !== null"> · median {{ row.median }} chars</template>
                </span>
              </div>
              <div class="mt-1.5 flex h-2.5 w-full overflow-hidden rounded">
                <div
                  v-for="band in BANDS"
                  :key="band"
                  :class="BAND_CLASS[band]"
                  :style="{ width: `${(row.bands[band] / Math.max(1, row.total)) * 100}%` }"
                  :title="`${band}: ${row.bands[band]}`"
                />
              </div>
              <div class="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span v-for="band in BANDS" :key="band">
                  <span class="inline-block h-2 w-2 rounded-sm align-middle" :class="BAND_CLASS[band]" />
                  {{ band }} <span class="font-mono text-foreground">{{ num(row.bands[band]) }}</span>
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- What the text says -->
    <section v-if="textRows.length">
      <h2 class="text-base font-semibold">What the text says</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        Every substantive remark, read by a classifier and labelled with the animal's condition
        and the events the text names. One row per source and classifier. Counts are records
        whose remark was judged to be about a koala; the full rows are on the Schema page under
        text_classifications.
      </p>

      <div class="mt-4 overflow-x-auto rounded border border-border">
        <table class="w-full min-w-[72rem] text-xs">
          <thead class="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Source</th>
              <th class="px-3 py-2 font-medium">Classifier</th>
              <th class="px-3 py-2 text-right font-medium">Remarks read</th>
              <th class="px-3 py-2 text-right font-medium">Healthy</th>
              <th class="px-3 py-2 text-right font-medium">Unwell</th>
              <th class="px-3 py-2 text-right font-medium">Dead</th>
              <th class="px-3 py-2 text-right font-medium">Not stated</th>
              <th v-for="e in TEXT_EVENTS" :key="e" class="px-3 py-2 text-right font-medium">{{ e.replace(/_/g, ' ') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in textRows" :key="`${row.source}-${row.t.classifier}`" class="border-t border-border">
              <td class="px-3 py-1.5 font-mono">{{ row.source }}</td>
              <td class="px-3 py-1.5">
                <span class="font-mono">{{ row.t.classifier }}</span>
                <span v-if="row.t.model" class="ml-2 font-mono text-[11px] text-muted-foreground">{{ row.t.model }} · prompt {{ row.t.promptVersion }}</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">{{ num(row.t.koalaRecords) }}</td>
              <td class="px-3 py-1.5 text-right font-mono">{{ num(row.t.byCondition.alive_healthy) }}</td>
              <td class="px-3 py-1.5 text-right font-mono text-amber-700 dark:text-amber-400">{{ num(row.t.byCondition.alive_unwell) }}</td>
              <td class="px-3 py-1.5 text-right font-mono text-rose-700 dark:text-rose-400">{{ num(row.t.byCondition.dead) }}</td>
              <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{{ num(row.t.byCondition.unknown) }}</td>
              <td v-for="e in TEXT_EVENTS" :key="e" class="px-3 py-1.5 text-right font-mono" :class="row.t.byEvent[e] ? '' : 'text-muted-foreground'">
                {{ num(row.t.byEvent[e]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Quality flags -->
    <section>
      <h2 class="text-base font-semibold">Quality flags on the records</h2>
      <p class="mt-1 max-w-3xl text-xs text-muted-foreground">
        Flags carried on the records as received: a source's own assertions, or for sources
        without any, the ones the adapter derives from the record's own fields. Each source has
        its own vocabulary, so they are listed side by side rather than added up.
      </p>
      <div class="mt-4 grid gap-6 lg:grid-cols-2">
        <div v-for="m in members" :key="m.harvestKey" class="min-w-0">
          <h3 class="font-mono text-sm">{{ m.source }}</h3>
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
  </div>
</template>
