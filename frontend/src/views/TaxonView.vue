<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { portalApi } from '@/apis/portal'
import { fmt } from '@/lib/insights'
import { useAsync } from '@/lib/useAsync'
import AsyncState from '@/components/AsyncState.vue'
import InsightRow from '@/components/InsightRow.vue'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, loading, error } = useAsync(() => portalApi.taxon(id.value), [id])
</script>

<template>
  <AsyncState :loading="loading" :error="error">
    <div v-if="data">
      <RouterLink to="/" class="text-sm text-muted-foreground hover:underline">← Report</RouterLink>
      <h1 class="mt-2 text-2xl font-semibold">{{ data.taxon.vernacular_name ?? data.taxon.scientific_name }}</h1>
      <p class="text-muted-foreground">
        <span class="italic">{{ data.taxon.scientific_name }}</span> · {{ data.taxon.national_status ?? 'status unknown' }} ·
        {{ data.taxon.family }}
      </p>
      <dl class="mt-4 grid max-w-xl grid-cols-3 gap-3 text-sm">
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Records since 2015</dt><dd class="text-lg font-semibold">{{ fmt(data.taxon.records_since_2015) }}</dd></div>
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Last record</dt><dd class="text-lg font-semibold">{{ data.taxon.last_record_day ?? '—' }}</dd></div>
        <div class="rounded-lg border p-3"><dt class="text-xs text-muted-foreground">Trend insights</dt><dd class="text-lg font-semibold">{{ data.taxon.statistical_tier ? 'Yes' : 'Too few records' }}</dd></div>
      </dl>

      <section class="mt-8">
        <h2 class="text-lg font-semibold">Calculated findings</h2>
        <p v-if="!data.insights.length" class="text-sm text-muted-foreground">No findings for this taxon in the current report.</p>
        <ul class="divide-y"><InsightRow v-for="i in data.insights" :key="i.insight_id" :insight="i" show-type /></ul>
      </section>

      <section v-if="data.ai_insights.length" class="mt-8">
        <h2 class="text-lg font-semibold">What the AI analyst said</h2>
        <p class="text-sm text-muted-foreground">
          Insights from AI runs that name this taxon — under evaluation against the calculated findings, not part of the report.
        </p>
        <ul class="mt-2 divide-y text-sm">
          <li v-for="a in data.ai_insights" :key="a.insight_id" class="py-2">
            <RouterLink :to="`/runs/${a.run_id}`" class="text-xs text-muted-foreground hover:underline">
              {{ a.brief }} brief · {{ a.prompt_version }}{{ a.category ? ` · ${a.category}` : ` · ${a.insight_type}` }}{{ a.region ? ` · ${a.region}` : '' }}
            </RouterLink>
            <p>{{ a.summary }}</p>
          </li>
        </ul>
      </section>
    </div>
  </AsyncState>
</template>
