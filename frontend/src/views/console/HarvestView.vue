<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import type { TextBand } from '@/apis/corpusTypes'
import { bytes, num, pct, sourceLabel } from '@/lib/format'

/**
 * Harvest — how each source's fetch went, for the window the selected run belongs to.
 *
 * Reads the family (every source fetched for the same species, region and window) rather
 * than the selected run, so it says the same thing whichever source is selected above.
 * Completeness, calls, frozen bytes and the text each source carried: the figures that say
 * whether a harvest can be trusted. What the sightings themselves say is the portal's job.
 */

const store = useCorpusStore()
const { family } = storeToRefs(store)

const members = computed(() => family.value?.members ?? [])

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
        detail behind a row is on the Schema page, under "About this source"; which sightings
        each source holds, and who supplied them, is on the portal's Sources page.
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

  </div>
</template>
