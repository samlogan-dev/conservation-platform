<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { portalApi, type Region } from '@/apis/portal'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import LabelBadge from '@/components/LabelBadge.vue'

const { data, loading, error } = useAsync(() => portalApi.regions())
const sortKey = ref<'region' | 'declines' | 'increases' | 'silences' | 'notable'>('declines')

const value = (r: Region, k: string) =>
  k === 'region' ? r.region : k === 'declines' ? (r.co_movement?.declines ?? -1) : k === 'increases' ? (r.co_movement?.increases ?? -1) : (r as any)[k]
const rows = computed(() =>
  [...(data.value?.regions ?? [])].sort((a, b) =>
    sortKey.value === 'region' ? a.region.localeCompare(b.region) : value(b, sortKey.value) - value(a, sortKey.value),
  ),
)
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
