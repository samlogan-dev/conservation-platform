<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { portalApi, type Insight } from '@/apis/portal'
import { INSIGHT_META, INSIGHT_ORDER } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'

const route = useRoute()
const region = computed(() => String(route.params.region))
const { data, loading, error } = useAsync(
  () => portalApi.insights({ region: region.value, limit: 500, sort: 'name' }),
  [region],
)
const byType = computed(() => {
  const out = new Map<string, Insight[]>()
  for (const i of data.value?.items ?? []) {
    // Unflagged reporting-rate rows are context, not findings: show flagged ones only.
    if (i.insight_type === 'reporting_rate' && !i.figures.flag) continue
    out.set(i.insight_type, [...(out.get(i.insight_type) ?? []), i])
  }
  return out
})
const coMovement = computed(() => data.value?.items.find((i) => i.insight_type === 'co_movement'))
</script>

<template>
  <div>
    <RouterLink to="/regions" class="text-sm text-muted-foreground hover:underline">← Bioregions</RouterLink>
    <h1 class="mt-2 text-2xl font-semibold">{{ region }}</h1>
    <AsyncState :loading="loading" :error="error">
      <p v-if="coMovement" class="mt-2 max-w-3xl text-muted-foreground">{{ coMovement.summary }}</p>
      <p v-if="!data?.items.length" class="mt-6 text-sm text-muted-foreground">No regional findings for this bioregion.</p>
      <div class="mt-6 space-y-8">
        <template v-for="type in INSIGHT_ORDER" :key="type">
          <section v-if="type !== 'co_movement' && byType.get(type)?.length">
            <h2 class="text-lg font-semibold">{{ INSIGHT_META[type].number }} · {{ INSIGHT_META[type].title }}</h2>
            <ul class="divide-y"><InsightRow v-for="i in byType.get(type)" :key="i.insight_id" :insight="i" /></ul>
          </section>
        </template>
      </div>
    </AsyncState>
  </div>
</template>
