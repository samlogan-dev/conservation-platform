<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { portalApi, type Region } from '@/apis/portal'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import LabelBadge from '@/components/LabelBadge.vue'
import { MIN_TAXA_FOR_BALANCE, regionBalance } from '@/lib/insights'
import RegionMap from '@/components/RegionMap.vue'

const { data, loading, error } = useAsync(() => portalApi.regions())
const sortKey = ref<'region' | 'declines' | 'increases' | 'silences' | 'notable'>('declines')

const value = (r: Region, k: string) =>
  k === 'region' ? r.region : k === 'declines' ? (r.co_movement?.declines ?? -1) : k === 'increases' ? (r.co_movement?.increases ?? -1) : (r as any)[k]
const rows = computed(() =>
  [...(data.value?.regions ?? [])].sort((a, b) =>
    sortKey.value === 'region' ? a.region.localeCompare(b.region) : value(b, sortKey.value) - value(a, sortKey.value),
  ),
)
/** What the map shades: one measure per bioregion. */
const MEASURES = {
  balance: { label: 'Reporting-rate balance', mode: 'diverging', tone: 'brand', legend: ['more declines', 'more increases'] },
  silences: { label: 'Gone quiet', mode: 'sequential', tone: 'alert', legend: ['none', 'most'] },
  notable: { label: 'Notable records', mode: 'sequential', tone: 'brand', legend: ['none', 'most'] },
} as const
const measure = ref<keyof typeof MEASURES>('balance')
const balance = computed(() => regionBalance(data.value?.regions ?? []))
const mapValues = computed(() =>
  Object.fromEntries(
    (data.value?.regions ?? []).map((r) => [
      r.region,
      measure.value === 'balance' ? (balance.value[r.region] ?? null) : r[measure.value],
    ]),
  ),
)
const flagged = computed(() => (data.value?.regions ?? []).filter((r) => r.co_movement?.flag).map((r) => r.region))
function tip(name: string) {
  const r = data.value?.regions.find((x) => x.region === name)
  if (!r) return `${name}: no regional findings`
  if (measure.value === 'balance') {
    const cm = r.co_movement
    return cm
      ? `${name}: ${cm.declines} declined, ${cm.increases} increased of ${cm.taxa_assessed} taxa${cm.flag ? ` — ${cm.flag === 'co_decline' ? 'co-decline' : 'co-increase'}` : ''}`
      : `${name}: no taxa assessed`
  }
  return `${name}: ${r[measure.value]} ${measure.value === 'silences' ? 'taxa gone quiet' : 'notable records'}`
}

const columns = [
  { key: 'region', label: 'Bioregion' },
  { key: 'declines', label: 'Declining' },
  { key: 'increases', label: 'Increasing' },
  { key: 'silences', label: 'Gone quiet' },
  { key: 'notable', label: 'Notable records' },
] as const
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold">Bioregions</h1>
    <p class="mt-1 max-w-3xl text-muted-foreground">
      IBRA 7 bioregions, the place-based unit of the Threatened Species Action Plan. Declining and increasing count the
      threatened taxa whose reporting rate moved 30% or more (insight 3); a flag marks more movement than the national
      rate predicts (insight 4). About 15% of threatened records are offshore and fall in no bioregion.
    </p>
    <AsyncState :loading="loading" :error="error">
      <section class="mt-6 max-w-3xl">
        <div class="mb-2 flex flex-wrap gap-1 text-sm">
          <button
            v-for="(m, k) in MEASURES"
            :key="k"
            class="rounded-md border px-2.5 py-1"
            :class="measure === k ? 'bg-foreground text-background' : 'hover:bg-muted'"
            @click="measure = k"
          >
            {{ m.label }}
          </button>
        </div>
        <RegionMap
          :values="mapValues"
          :mode="MEASURES[measure].mode"
          :tone="MEASURES[measure].tone"
          :legend="[...MEASURES[measure].legend]"
          :outlined="measure === 'balance' ? flagged : []"
          :tooltip="tip"
        />
        <p v-if="measure === 'balance'" class="text-xs text-muted-foreground">
          Reporting-rate increases minus declines as a share of taxa assessed (blank under {{ MIN_TAXA_FOR_BALANCE }} taxa);
          outlined bioregions are flagged for co-movement.
        </p>
      </section>
      <div class="mt-6 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b text-left text-muted-foreground">
            <tr>
              <th v-for="c in columns" :key="c.key" class="px-2 py-2 font-medium">
                <button class="hover:text-foreground" :class="sortKey === c.key && 'text-foreground underline'" @click="sortKey = c.key">
                  {{ c.label }}
                </button>
              </th>
              <th class="px-2 py-2 font-medium">Co-movement</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="r in rows" :key="r.region" class="hover:bg-muted/50">
              <td class="px-2 py-2">
                <RouterLink :to="`/regions/${encodeURIComponent(r.region)}`" class="font-medium hover:underline">{{ r.region }}</RouterLink>
              </td>
              <td class="px-2 py-2">{{ r.co_movement ? `${r.co_movement.declines} of ${r.co_movement.taxa_assessed}` : '—' }}</td>
              <td class="px-2 py-2">{{ r.co_movement ? `${r.co_movement.increases} of ${r.co_movement.taxa_assessed}` : '—' }}</td>
              <td class="px-2 py-2">{{ r.silences || '—' }}</td>
              <td class="px-2 py-2">{{ r.notable || '—' }}</td>
              <td class="px-2 py-2">
                <LabelBadge v-if="r.co_movement?.flag" :label="r.co_movement.flag" :text="r.co_movement.flag === 'co_decline' ? 'Co-decline' : 'Co-increase'" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
  </div>
</template>
