<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { portalApi, type InsightType } from '@/apis/portal'
import { INSIGHT_META, fmt } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'

const route = useRoute()
const type = computed(() => route.params.type as Exclude<InsightType, 'other'>)
const meta = computed(() => INSIGHT_META[type.value])

const label = ref<string>('')
const scope = ref<'' | 'national' | 'regional'>('')
const group = ref('')
const search = ref('')
const debounced = ref('')
const page = ref(0)
const PAGE = 50
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (debounced.value = v), 250)
})
watch([type, label, scope, group, debounced], () => (page.value = 0))
watch(type, () => {
  label.value = Object.keys(meta.value.labels)[0] ?? ''
  scope.value = ''
}, { immediate: true })

const sort = computed(() => {
  if (type.value === 'range_change' && label.value === 'expansion') return 'aoo_change_desc'
  if (type.value === 'reporting_rate' && label.value === 'increase') return 'detection_ratio_desc'
  if (type.value === 'co_movement' && label.value === 'co_increase') return 'p_increase'
  if (type.value === 'silent_species' && label.value === 'regional_silence') return 'baseline_records'
  if (type.value === 'silent_species' && label.value === 'evidence_gap') return 'records_since_2015'
  return meta.value.defaultSort
})

const { data, loading, error } = useAsync(
  () =>
    portalApi.insights({
      type: type.value,
      label: label.value === '__unflagged' ? 'none' : label.value || undefined,
      region: scope.value || undefined,
      group: group.value || undefined,
      q: debounced.value || undefined,
      sort: sort.value,
      limit: PAGE,
      offset: page.value * PAGE,
    }),
  [type, label, scope, group, debounced, page],
)
const showScope = computed(() => ['reporting_rate', 'silent_species'].includes(type.value))
const showGroup = computed(() => type.value !== 'co_movement')
</script>

<template>
  <div>
    <RouterLink to="/" class="text-sm text-muted-foreground hover:underline">← Report</RouterLink>
    <h1 class="mt-2 text-2xl font-semibold">{{ meta.number }} · {{ meta.title }}</h1>
    <p class="mt-1 max-w-3xl text-muted-foreground">{{ meta.question }}</p>

    <div class="mt-6 flex flex-wrap items-center gap-2 text-sm">
      <template v-if="Object.keys(meta.labels).length">
        <button
          v-for="(text, key) in meta.labels"
          :key="key"
          class="rounded-full border px-3 py-1"
          :class="label === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
          @click="label = String(key)"
        >
          {{ text }}
        </button>
        <button
          v-if="type === 'range_change' || type === 'reporting_rate' || type === 'co_movement'"
          class="rounded-full border px-3 py-1"
          :class="label === '__unflagged' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
          @click="label = '__unflagged'"
        >
          Not flagged
        </button>
      </template>
      <select v-if="showScope" v-model="scope" class="rounded-md border bg-background px-2 py-1">
        <option value="">National and regional</option>
        <option value="national">National</option>
        <option value="regional">By bioregion</option>
      </select>
      <select v-if="showGroup" v-model="group" class="rounded-md border bg-background px-2 py-1">
        <option value="">All groups</option>
        <option v-for="g in ['birds', 'mammals', 'reptiles', 'amphibians', 'plants', 'other']" :key="g" :value="g">{{ g }}</option>
      </select>
      <input
        v-model="search"
        type="search"
        placeholder="Search species or bioregion"
        class="min-w-0 flex-1 rounded-md border bg-background px-3 py-1 sm:max-w-xs"
      />
    </div>

    <AsyncState :loading="loading && !data" :error="error">
      <template v-if="data">
        <p class="mt-4 text-sm text-muted-foreground">{{ fmt(data.total) }} findings</p>
        <ul class="divide-y" :class="loading && 'opacity-60'">
          <InsightRow v-for="i in data.items" :key="i.insight_id" :insight="i" />
        </ul>
        <div v-if="data.total > PAGE" class="mt-4 flex items-center gap-3 text-sm">
          <button class="btn" :disabled="page === 0" @click="page--">Previous</button>
          <span>Page {{ page + 1 }} of {{ Math.ceil(data.total / PAGE) }}</span>
          <button class="btn" :disabled="(page + 1) * PAGE >= data.total" @click="page++">Next</button>
        </div>
      </template>
    </AsyncState>
  </div>
</template>
