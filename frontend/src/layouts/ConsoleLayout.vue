<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useCorpusStore } from '@/stores/corpusStore'
import { useSyncStore } from '@/stores/syncStore'
import RunHeader from '@/components/corpus/RunHeader.vue'

/**
 * The researcher console: how the data was collected and stored, one run at a time.
 *
 * This is where a harvest is started, where a frozen response is read verbatim, and where a
 * record is checked against the schema — everything an examiner or the researcher needs to
 * trust the pipeline, and nothing a practitioner needs to act on its output. The portal is
 * that other surface; it reads the same data by species, region and window instead of by run.
 */

const store = useCorpusStore()
const { loading, error, ready, harvestKey, runId } = storeToRefs(store)
const route = useRoute()
const sync = useSyncStore()
const { running } = storeToRefs(sync)

/** `?harvest=…&run=…` — how the portal links a figure to the run it came from. */
const requested = () => ({
  harvestKey: typeof route.query.harvest === 'string' ? route.query.harvest : undefined,
  runId: typeof route.query.run === 'string' ? route.query.run : undefined,
})

// The sync state loads console-wide so a harvest in progress shows on every console page.
onMounted(() => {
  void store.init(requested())
  void sync.load()
})

// A second portal link followed while the console is already open moves the selection.
watch(
  () => [route.query.harvest, route.query.run],
  () => {
    const { harvestKey: key, runId: run } = requested()
    if (!key || !ready.value || (key === harvestKey.value && (!run || run === runId.value))) return
    const harvest = store.harvests.find((h) => h.key === key)
    const target = harvest?.runs.find((r) => r.runId === run) ?? harvest?.runs[0]
    if (harvest && target) void store.selectRun(harvest.key, target.runId)
  },
)

const NAV = [
  { to: '/console', label: '1 · Raw data', hint: 'What the source actually returned, frozen verbatim' },
  { to: '/console/schema', label: '2 · Schema', hint: 'The records as the database holds them, checked against the schema' },
  { to: '/console/harvest', label: 'Harvest', hint: 'How each source\'s fetch went: completeness, calls, bytes, and the text it carried' },
  { to: '/console/insights', label: 'Insights', hint: 'What the sources say about each other: coverage, content loss, obscuring, flags' },
  { to: '/console/analysis', label: 'AI analysis', hint: 'Generate the model\'s reading of a window; the portal shows the result' },
]
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="border-b border-border px-6 py-3">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 class="text-sm font-semibold">
            Conservation Reporting Platform
            <span class="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Console</span>
          </h1>
          <p class="text-xs text-muted-foreground">
            How the data was collected and stored, one run at a time
          </p>
        </div>
        <nav class="flex flex-wrap items-center gap-1 text-xs">
          <RouterLink
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            :title="item.hint"
            class="rounded px-2.5 py-1 hover:bg-muted"
            :class="route.path === item.to ? 'bg-muted font-medium' : 'text-muted-foreground'"
          >{{ item.label }}</RouterLink>
          <RouterLink
            to="/console/run"
            title="Harvest a window from every source and watch it land"
            class="ml-2 flex items-center gap-1.5 rounded border border-border px-2.5 py-1 font-medium hover:bg-muted"
            :class="route.path === '/console/run' ? 'bg-muted' : ''"
          >
            <span v-if="running" class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
            {{ running ? 'Running…' : '▶ Run' }}
          </RouterLink>
          <RouterLink
            to="/"
            title="The practitioner portal: the same data by species, region and window"
            class="ml-2 rounded px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >Portal →</RouterLink>
        </nav>
      </div>
    </header>

    <!-- The Run page makes runs rather than reading one, so it needs neither the strip nor a corpus. -->
    <RouterView v-if="route.path === '/console/run'" />

    <template v-else>
      <RunHeader />

      <p v-if="loading" class="p-6 text-sm text-muted-foreground">Loading…</p>

      <div v-else-if="error" class="m-6 rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
        <p class="font-medium">Could not load a corpus.</p>
        <p class="mt-1 text-xs">{{ error }}</p>
        <p class="mt-3 text-xs">
          Start a harvest from the <RouterLink to="/console/run" class="underline">Run page</RouterLink>, or from the terminal:
        </p>
        <pre class="mt-2 rounded bg-background/60 p-2 font-mono text-[11px]">cd platform/backend
  npm run ingest -- harvest</pre>
      </div>

      <RouterView v-else-if="ready" />
    </template>
  </div>
</template>
