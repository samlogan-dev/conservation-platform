<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useCorpusStore } from '@/stores/corpusStore'
import RunHeader from '@/components/corpus/RunHeader.vue'

const store = useCorpusStore()
const { loading, error, ready } = storeToRefs(store)
const route = useRoute()

onMounted(() => store.init())

const NAV = [
  { to: '/', label: '1 · Raw data', hint: 'What the source actually returned, frozen verbatim' },
  { to: '/schema', label: '2 · Schema', hint: 'The records as the database holds them, checked against the schema' },
  { to: '/statistics', label: '3 · Statistics', hint: 'What was fetched, and which sightings each source holds' },
  { to: '/insights', label: '4 · Insights', hint: 'What the numbers mean' },
]
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="border-b border-border px-6 py-3">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 class="text-sm font-semibold">Conservation Reporting Platform</h1>
          <p class="text-xs text-muted-foreground">
            One species, two sources, end to end
          </p>
        </div>
        <nav class="flex gap-1 text-xs">
          <RouterLink
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            :title="item.hint"
            class="rounded px-2.5 py-1 hover:bg-muted"
            :class="route.path === item.to ? 'bg-muted font-medium' : 'text-muted-foreground'"
          >{{ item.label }}</RouterLink>
        </nav>
      </div>
    </header>

    <RunHeader />

    <p v-if="loading" class="p-6 text-sm text-muted-foreground">Loading…</p>

    <div v-else-if="error" class="m-6 rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
      <p class="font-medium">Could not load a corpus.</p>
      <p class="mt-1 text-xs">{{ error }}</p>
      <pre class="mt-3 rounded bg-background/60 p-2 font-mono text-[11px]">cd platform/backend
npm run ingest -- harvest</pre>
    </div>

    <RouterView v-else-if="ready" />
  </div>
</template>
