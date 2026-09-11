<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useCorpusStore } from '@/stores/corpusStore'
import { num, shortHash } from '@/lib/format'

/**
 * The provenance strip. Every view sits under it, because a number from this corpus means
 * nothing without the query and the run that produced it — and because "complete" being
 * visible at all times is the guard against quietly reading a truncated harvest.
 *
 * Pages 1 and 2 are scoped to one run, so the strip shows that run. Pages 3 and 4 read across
 * every source for the same species, region and window, so there it shows the family instead:
 * the scope, and one chip per source.
 */
const store = useCorpusStore()
const { manifest, harvests, harvestKey, runId, family } = storeToRefs(store)
const route = useRoute()

const crossSource = computed(() => route.path === '/statistics' || route.path === '/insights')

function onSelect(event: Event) {
  const [key, run] = (event.target as HTMLSelectElement).value.split('::')
  if (key && run) store.selectRun(key, run)
}
</script>

<template>
  <section v-if="manifest" class="border-b border-border bg-muted/30 px-6 py-3 text-xs">
    <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <div>
        <span class="text-muted-foreground">run</span>
        <select
          class="ml-2 rounded border border-border bg-background px-1.5 py-0.5 font-mono"
          :value="`${harvestKey}::${runId}`"
          @change="onSelect"
        >
          <optgroup v-for="h in harvests" :key="h.key" :label="h.key">
            <option v-for="r in h.runs" :key="r.runId" :value="`${h.key}::${r.runId}`">
              {{ r.runId }} — {{ num(r.retrievedRecords) }} records
            </option>
          </optgroup>
        </select>
      </div>

      <!-- Cross-source pages: the family this run belongs to -->
      <template v-if="crossSource && family">
        <div>
          <span class="text-muted-foreground">scope</span>
          <span class="ml-2 font-mono">{{ family.speciesKey }} · {{ family.regionKey }} · {{ family.startDate }} → {{ family.endDate }}</span>
        </div>
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="text-muted-foreground">sources</span>
          <span
            v-for="m in family.members"
            :key="m.harvestKey"
            class="rounded bg-muted px-1.5 py-0.5 font-mono"
            :title="`${m.harvestKey} / ${m.runId}`"
          >
            {{ m.source }} · {{ num(m.manifest.retrievedRecords) }}
            <span :class="m.manifest.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
              {{ m.manifest.complete ? '✓' : '✗' }}
            </span>
          </span>
        </div>
      </template>

      <!-- Single-run pages: this run -->
      <template v-else>
        <div>
          <span class="text-muted-foreground">source</span>
          <span class="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono">{{ manifest.source }}</span>
        </div>

        <div>
          <span class="text-muted-foreground">records</span>
          <span class="ml-2 font-mono">{{ num(manifest.retrievedRecords) }} / {{ num(manifest.expectedRecords) }}</span>
        </div>

        <div>
          <span class="text-muted-foreground">complete</span>
          <span
            class="ml-2 rounded px-1.5 py-0.5 font-medium"
            :class="manifest.complete
              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200'"
          >{{ manifest.complete ? 'yes' : 'no' }}</span>
        </div>

        <div :title="manifest.corpusHash">
          <span class="text-muted-foreground">corpus hash</span>
          <span class="ml-2 font-mono">{{ shortHash(manifest.corpusHash) }}</span>
        </div>

        <div>
          <span class="text-muted-foreground">requests</span>
          <span class="ml-2 font-mono">{{ manifest.requestCount }}</span>
          <span class="ml-1 text-muted-foreground">at ≥{{ manifest.politeness.minRequestIntervalMs }}ms</span>
        </div>
      </template>
    </div>

    <p v-if="!crossSource" class="mt-2 font-mono text-[11px] text-muted-foreground">
      {{ manifest.query.q }}<span v-for="fq in manifest.query.fq" :key="fq"> &nbsp;|&nbsp; {{ fq }}</span>
    </p>

    <ul v-if="!crossSource && manifest.warnings.length" class="mt-2 space-y-1">
      <li v-for="w in manifest.warnings" :key="w" class="text-amber-700 dark:text-amber-400">⚠ {{ w }}</li>
    </ul>
    <ul v-else-if="crossSource && family" class="mt-2 space-y-1">
      <template v-for="m in family.members" :key="m.harvestKey">
        <li v-for="w in m.manifest.warnings" :key="w" class="text-amber-700 dark:text-amber-400">⚠ {{ m.source }}: {{ w }}</li>
      </template>
    </ul>
  </section>
</template>
