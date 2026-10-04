<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { Insight, LoggedQuery } from '@/apis/portal'
import { portalApi } from '@/apis/portal'
import { INSIGHT_META, caveatOf, isHeadline, keyFigures, labelOf, movedTaxaText, reasonText, taxonName } from '@/lib/insights'
import LabelBadge from './LabelBadge.vue'
import FigureTable from './FigureTable.vue'

const props = defineProps<{ insight: Insight; showType?: boolean }>()
const open = ref(false)
const queries = ref<LoggedQuery[] | null>(null)

async function loadQueries() {
  if (queries.value || !props.insight.query_ids.length) return
  queries.value = (await portalApi.queries(props.insight.query_ids)).queries
}

const meta = props.insight.insight_type !== 'other' ? INSIGHT_META[props.insight.insight_type] : null
const label = labelOf(props.insight)
</script>

<template>
  <li class="py-3">
    <div class="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <RouterLink
            v-if="insight.taxon_concept_id"
            :to="`/taxa/${encodeURIComponent(insight.taxon_concept_id)}`"
            class="font-medium hover:underline"
          >
            {{ taxonName(insight) }}
          </RouterLink>
          <RouterLink
            v-else-if="insight.insight_type === 'co_movement'"
            :to="`/regions/${encodeURIComponent(insight.region ?? '')}`"
            class="font-medium hover:underline"
          >
            {{ insight.region }}
          </RouterLink>
          <span v-else class="font-medium">{{ insight.figures.category ?? (isHeadline(insight) ? 'Headline count' : 'Overview') }}</span>
          <span v-if="insight.scientific_name && insight.vernacular_name" class="text-sm italic text-muted-foreground">
            {{ insight.scientific_name }}
          </span>
          <span v-if="insight.national_status" class="text-xs text-muted-foreground">· {{ insight.national_status }}</span>
          <RouterLink
            v-if="insight.region && insight.insight_type !== 'co_movement'"
            :to="`/regions/${encodeURIComponent(insight.region)}`"
            class="text-xs text-muted-foreground hover:underline"
          >
            · {{ insight.region }}
          </RouterLink>
        </div>
        <div class="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-sm">
          <span v-for="f in keyFigures(insight)" :key="f.label">
            <span class="text-muted-foreground">{{ f.label }}:</span> {{ f.value }}
          </span>
          <span v-if="insight.figures.reasons?.length" class="text-muted-foreground">
            {{ insight.figures.reasons.map(reasonText).join(' · ') }}
          </span>
        </div>
        <p v-if="insight.insight_type === 'co_movement' && movedTaxaText(insight)" class="mt-1 text-sm text-muted-foreground">
          {{ movedTaxaText(insight) }}
        </p>
        <p v-if="caveatOf(insight)" class="mt-1 inline-block rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">
          {{ caveatOf(insight) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="showType && meta" class="text-xs text-muted-foreground">#{{ meta.number }} {{ meta.title }}</span>
        <LabelBadge v-if="label || insight.insight_type !== 'notable_record'" :label="label" :text="label ? (meta?.labels[label] ?? label) : undefined" />
        <button class="text-xs text-muted-foreground hover:text-foreground" @click="open = !open; loadQueries()">
          {{ open ? 'Less' : 'Details' }}
        </button>
      </div>
    </div>

    <div v-if="open" class="mt-3 space-y-3 rounded-md border bg-muted/40 p-3">
      <p class="text-sm">{{ insight.summary }}</p>
      <p class="text-xs text-muted-foreground">Period {{ insight.period_start }} to {{ insight.period_end }}</p>
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Figures</h4>
          <FigureTable :data="insight.figures" :hide="['declining_taxa', 'increasing_taxa', 'category']" />
        </div>
        <div>
          <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data confidence</h4>
          <FigureTable :data="insight.confidence" />
        </div>
      </div>
      <div v-if="insight.query_ids.length">
        <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Supporting queries (as the AI ran them)
        </h4>
        <p v-if="!queries" class="text-xs text-muted-foreground">Loading…</p>
        <details v-for="q in queries ?? []" :key="q.query_id" class="mb-1 text-xs">
          <summary class="cursor-pointer">
            Query {{ q.query_id }} — {{ q.row_count }} rows{{ q.truncated ? ' (capped)' : '' }}, {{ q.duration_ms }} ms
          </summary>
          <pre class="mt-1 overflow-x-auto rounded bg-background p-2 font-mono whitespace-pre-wrap">{{ q.sql }}</pre>
        </details>
      </div>
    </div>
  </li>
</template>
