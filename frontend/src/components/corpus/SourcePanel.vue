<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import type { Analysis, Manifest } from '@/apis/corpusTypes'
import CoverageBar from '@/components/corpus/CoverageBar.vue'
import { bytes, num, pct, sourceLabel } from '@/lib/format'

/**
 * The essentials of one source's run, collapsed to a line of chips until opened. Sits on the
 * Schema page above the tables, because that page is the one that is scoped to a single run;
 * the Statistics and Insights pages read across every source instead.
 */
const props = defineProps<{
  manifest: Manifest
  analysis: Analysis
}>()

const open = ref(false)

const frozenBytes = computed(() => props.manifest.pages.reduce((sum, p) => sum + p.bytes, 0))
const balancedSlices = computed(
  () => props.manifest.slices.filter((s) => s.expectedRecords === s.retrievedRecords).length,
)
const remarks = computed(
  () => props.analysis.freeText.find((f) => f.canonicalField === 'occurrenceRemarks') ?? null,
)
const obscured = computed(() =>
  props.analysis.resources.reduce((sum, r) => sum + r.obscuredRecords, 0),
)
const maxRecords = computed(() => Math.max(1, ...props.analysis.resources.map((r) => r.records)))

const BAND_CLASS: Record<string, string> = {
  substantive: 'bg-emerald-500',
  short: 'bg-sky-400',
  trivial: 'bg-amber-400',
  absent: 'bg-neutral-300 dark:bg-neutral-700',
}
</script>

<template>
  <section class="border-b border-border">
    <button
      class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-xs hover:bg-muted/40"
      @click="open = !open"
    >
      <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" :class="open ? 'rotate-90' : ''" />
      <span class="font-medium">About this source</span>
      <span class="rounded bg-muted px-1.5 py-0.5 font-mono">{{ manifest.source }}</span>
      <span class="text-muted-foreground">
        <span class="font-mono text-foreground">{{ num(manifest.retrievedRecords) }}</span>
        of {{ num(manifest.expectedRecords) }} records
      </span>
      <span
        class="rounded px-1.5 py-0.5 font-medium"
        :class="manifest.complete
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
          : 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200'"
      >{{ manifest.complete ? 'complete' : 'incomplete' }}</span>
      <span class="text-muted-foreground">
        <span class="font-mono text-foreground">{{ analysis.resources.length }}</span>
        dataset{{ analysis.resources.length === 1 ? '' : 's' }}
      </span>
      <span v-if="remarks" class="text-muted-foreground">
        <span class="font-mono text-foreground">{{ pct(remarks.substantiveShare) }}</span> substantive text
      </span>
      <span class="text-muted-foreground">
        <span class="font-mono" :class="obscured ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'">{{ num(obscured) }}</span>
        obscured &gt;10 km
      </span>
      <span class="text-muted-foreground">
        <span class="font-mono text-foreground">{{ manifest.requestCount }}</span> calls ·
        <span class="font-mono text-foreground">{{ bytes(frozenBytes) }}</span> frozen
      </span>
    </button>

    <div v-if="open" class="space-y-5 border-t border-border bg-muted/20 px-4 py-4">
      <p class="text-xs text-muted-foreground">{{ manifest.description }}</p>

      <!-- What was fetched -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="min-w-0 rounded border border-border bg-background p-3">
          <p class="text-[11px] text-muted-foreground">Records retrieved</p>
          <p class="mt-0.5 font-mono text-lg">{{ num(manifest.retrievedRecords) }}</p>
          <p class="text-[11px] text-muted-foreground">of {{ num(manifest.expectedRecords) }} the source reported</p>
        </div>
        <div class="min-w-0 rounded border border-border bg-background p-3">
          <p class="text-[11px] text-muted-foreground">Complete</p>
          <p class="mt-0.5 font-mono text-lg" :class="manifest.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
            {{ manifest.complete ? 'yes' : 'no' }}
          </p>
          <p class="text-[11px] text-muted-foreground">{{ balancedSlices }} of {{ manifest.slices.length }} slices balanced</p>
        </div>
        <div class="min-w-0 rounded border border-border bg-background p-3">
          <p class="text-[11px] text-muted-foreground">API calls</p>
          <p class="mt-0.5 font-mono text-lg">{{ num(manifest.requestCount) }}</p>
          <p class="text-[11px] text-muted-foreground">
            ≥{{ manifest.politeness.minRequestIntervalMs }}ms apart · {{ (manifest.durationMs / 1000).toFixed(1) }}s
          </p>
        </div>
        <div class="min-w-0 rounded border border-border bg-background p-3">
          <p class="text-[11px] text-muted-foreground">Frozen on disk</p>
          <p class="mt-0.5 font-mono text-lg">{{ bytes(frozenBytes) }}</p>
          <p class="text-[11px] text-muted-foreground">{{ manifest.pages.length }} response files, verbatim</p>
        </div>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <!-- Slices -->
        <div class="min-w-0">
          <h3 class="text-xs font-semibold">Fetched in slices</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            Each counted before paging and reconciled after, because the source caps how far into a query it will page.
          </p>
          <div class="mt-2 overflow-x-auto rounded border border-border bg-background">
            <table class="w-full text-xs">
              <thead class="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th class="px-2 py-1.5 font-medium">Slice</th>
                  <th class="px-2 py-1.5 text-right font-medium">Reported</th>
                  <th class="px-2 py-1.5 text-right font-medium">Retrieved</th>
                  <th class="px-2 py-1.5 text-right font-medium">Calls</th>
                  <th class="px-2 py-1.5 text-right font-medium">Balanced</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in manifest.slices" :key="s.sliceKey" class="border-t border-border">
                  <td class="px-2 py-1 font-mono">{{ s.sliceKey }}</td>
                  <td class="px-2 py-1 text-right font-mono">{{ num(s.expectedRecords) }}</td>
                  <td class="px-2 py-1 text-right font-mono">{{ num(s.retrievedRecords) }}</td>
                  <td class="px-2 py-1 text-right font-mono">{{ s.pages }}</td>
                  <td class="px-2 py-1 text-right" :class="s.expectedRecords === s.retrievedRecords ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                    {{ s.expectedRecords === s.retrievedRecords ? '✓' : '✗' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-1.5 text-[11px] text-muted-foreground">
            Corpus hash <span class="ml-1 break-all font-mono text-foreground">{{ manifest.corpusHash }}</span>
          </p>
        </div>

        <!-- Datasets -->
        <div class="min-w-0">
          <h3 class="text-xs font-semibold">Datasets inside {{ sourceLabel(manifest.source) }}</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            Who contributed the records, and how precisely each contributor locates them.
          </p>
          <div class="mt-2 overflow-x-auto rounded border border-border bg-background">
            <table class="w-full text-xs">
              <thead class="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th class="px-2 py-1.5 font-medium">Dataset</th>
                  <th class="w-28 px-2 py-1.5 font-medium">Share</th>
                  <th class="px-2 py-1.5 text-right font-medium">Records</th>
                  <th class="px-2 py-1.5 text-right font-medium">Text</th>
                  <th class="px-2 py-1.5 text-right font-medium">Median unc.</th>
                  <th class="px-2 py-1.5 text-right font-medium">Obscured</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in analysis.resources" :key="r.dataResourceUid ?? r.dataResourceName" class="border-t border-border">
                  <td class="px-2 py-1">
                    {{ r.dataResourceName }}
                    <span class="ml-1 font-mono text-[10px] text-muted-foreground">{{ r.dataResourceUid }}</span>
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex items-center gap-2">
                      <CoverageBar :value="r.records / maxRecords" />
                      <span class="w-10 shrink-0 text-right font-mono">{{ pct(r.share, 0) }}</span>
                    </div>
                  </td>
                  <td class="px-2 py-1 text-right font-mono">{{ num(r.records) }}</td>
                  <td class="px-2 py-1 text-right font-mono">{{ pct(r.records ? r.substantiveRemarks / r.records : 0, 0) }}</td>
                  <td class="px-2 py-1 text-right font-mono">
                    <template v-if="r.medianCoordinateUncertainty !== null">{{ num(Math.round(r.medianCoordinateUncertainty)) }} m</template>
                    <span v-else class="text-muted-foreground">—</span>
                  </td>
                  <td class="px-2 py-1 text-right font-mono" :class="r.obscuredRecords ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'">
                    {{ num(r.obscuredRecords) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Free text -->
        <div class="min-w-0">
          <h3 class="text-xs font-semibold">Free text</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            Substance, not presence: substantive is at least three words and 20 characters.
          </p>
          <div class="mt-2 space-y-2">
            <div v-for="f in analysis.freeText" :key="f.canonicalField" class="rounded border border-border bg-background p-2.5">
              <div class="flex items-baseline justify-between gap-2 text-xs">
                <span class="font-mono">{{ f.canonicalField }}</span>
                <span class="text-muted-foreground">
                  <span class="font-mono text-foreground">{{ pct(f.substantiveShare) }}</span> substantive · median {{ f.medianLength }} chars
                </span>
              </div>
              <div class="mt-1.5 flex h-2 w-full overflow-hidden rounded">
                <div
                  v-for="band in (['substantive', 'short', 'trivial', 'absent'] as const)"
                  :key="band"
                  :class="BAND_CLASS[band]"
                  :style="{ width: `${(f.bands[band] / Math.max(1, f.total)) * 100}%` }"
                  :title="`${band}: ${f.bands[band]}`"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Flags -->
        <div class="min-w-0">
          <h3 class="text-xs font-semibold">Quality flags on the records</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">Counted as received, never reinterpreted.</p>
          <ul v-if="analysis.sourceAssertions.length" class="mt-2 space-y-1 text-xs">
            <li v-for="a in analysis.sourceAssertions.slice(0, 8)" :key="a.assertion" class="flex items-center gap-2">
              <span class="w-12 shrink-0 text-right font-mono">{{ num(a.count) }}</span>
              <span class="w-9 shrink-0 text-right font-mono text-muted-foreground">{{ pct(a.share, 0) }}</span>
              <span class="min-w-0 flex-1"><CoverageBar :value="a.share" /></span>
              <span class="w-52 shrink-0 truncate font-mono" :title="a.assertion">{{ a.assertion }}</span>
            </li>
          </ul>
          <p v-else class="mt-2 text-xs text-muted-foreground">None on any record.</p>
        </div>
      </div>
    </div>
  </section>
</template>
