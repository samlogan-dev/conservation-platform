<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { usePortalStore } from '@/stores/portalStore'
import { consoleRunLink, windowLabel } from '@/lib/windows'
import { num, sourceLabel } from '@/lib/format'

/**
 * The practitioner portal: what the data says, by species, region and window.
 *
 * A reader chooses a place and a period, never a run. The strip under the header still names
 * the run behind every source, and links into the console where a figure can be traced to
 * the records and the frozen responses it came from — clean here means checked and
 * annotated, not filtered, so the way back to the evidence is always one click.
 */

const store = usePortalStore()
const { scopes, scope, currentWindow, family, loading, familyLoading, error, consoleEnabled } = storeToRefs(store)
const route = useRoute()
const router = useRouter()

const NAV = [
  { to: '/', label: 'Overview', hint: 'Every year at a glance, every source merged', perWindow: false },
  { to: '/sources', label: 'Sources', hint: 'Where the sightings come from: what joining the sources adds, kinds of record, datasets, flags', perWindow: true },
  { to: '/analysis', label: 'AI analysis', hint: 'What the model finds most worth knowing, checked against the numbers', perWindow: true },
]

/** The overview spans every year; every other page reads one window. */
const perWindow = computed(() => route.path !== '/')

const navTarget = (to: string) => (store.windowId ? { path: to, query: { window: store.windowId } } : { path: to })

const queryWindow = () => (typeof route.query.window === 'string' ? route.query.window : null)

/** Follow the URL; on a per-window page, write the window actually used back into it. */
async function syncWindow(force = false) {
  const asked = queryWindow()
  const used = await store.selectWindow(asked, force)
  if (perWindow.value && used && used !== asked) {
    await router.replace({ path: route.path, query: { ...route.query, window: used } })
  }
}

onMounted(async () => {
  await store.init()
  await syncWindow(true)
})

watch(() => [route.query.window, route.path], () => {
  if (store.info) void syncWindow()
})

function onWindow(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  void router.push({ path: route.path, query: { ...route.query, window: id } })
}

function onScope(event: Event) {
  const [speciesKey, regionKey] = (event.target as HTMLSelectElement).value.split('/')
  const id = speciesKey && regionKey ? store.defaultWindowFor(speciesKey, regionKey) : null
  if (id) void router.push({ path: route.path, query: { ...route.query, window: id } })
}

const calendarWindows = computed(() => scope.value?.windows.filter((w) => w.calendarYear !== null) ?? [])
const otherWindows = computed(() => scope.value?.windows.filter((w) => w.calendarYear === null) ?? [])
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="border-b border-border px-6 py-3">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 class="text-sm font-semibold">Conservation Reporting Platform</h1>
          <p class="text-xs text-muted-foreground">
            Threatened-species sightings from every source, checked and joined
          </p>
        </div>
        <nav class="flex flex-wrap items-center gap-1 text-xs">
          <RouterLink
            v-for="item in NAV"
            :key="item.to"
            :to="navTarget(item.to)"
            :title="item.hint"
            class="rounded px-2.5 py-1 hover:bg-muted"
            :class="route.path === item.to ? 'bg-muted font-medium' : 'text-muted-foreground'"
          >{{ item.label }}</RouterLink>
          <RouterLink
            v-if="consoleEnabled"
            to="/console"
            title="The researcher console: how the data was collected and stored, run by run"
            class="ml-2 rounded px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >Console →</RouterLink>
        </nav>
      </div>
    </header>

    <!-- Scope: what this page is about, and the runs behind it. -->
    <section v-if="scope" class="border-b border-border bg-muted/30 px-6 py-3 text-xs">
      <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <span class="text-muted-foreground">species</span>
          <select
            v-if="scopes.length > 1"
            class="ml-2 rounded border border-border bg-background px-1.5 py-0.5"
            :value="`${scope.speciesKey}/${scope.regionKey}`"
            @change="onScope"
          >
            <option v-for="s in scopes" :key="`${s.speciesKey}/${s.regionKey}`" :value="`${s.speciesKey}/${s.regionKey}`">
              {{ s.vernacularName }} · {{ s.regionLabel }}
            </option>
          </select>
          <span v-else class="ml-2">
            <span class="font-medium">{{ scope.vernacularName }}</span>
            <em v-if="scope.scientificName" class="ml-1 text-muted-foreground">{{ scope.scientificName }}</em>
            <span class="text-muted-foreground"> · </span>{{ scope.regionLabel }}
          </span>
        </div>

        <div v-if="perWindow">
          <span class="text-muted-foreground">window</span>
          <select
            class="ml-2 rounded border border-border bg-background px-1.5 py-0.5"
            :value="store.windowId ?? ''"
            @change="onWindow"
          >
            <optgroup v-if="calendarWindows.length" label="Calendar years">
              <option v-for="w in calendarWindows" :key="w.id" :value="w.id">
                {{ windowLabel(w) }}{{ w.inProgress ? ' (in progress)' : '' }}
              </option>
            </optgroup>
            <optgroup v-if="otherWindows.length" label="Other windows">
              <option v-for="w in otherWindows" :key="w.id" :value="w.id">
                {{ windowLabel(w) }}{{ w.inProgress ? ' (in progress)' : '' }}
              </option>
            </optgroup>
          </select>
        </div>
        <div v-else>
          <span class="text-muted-foreground">window</span>
          <span class="ml-2">every calendar year harvested</span>
        </div>

        <div v-if="perWindow && currentWindow" class="flex flex-wrap items-baseline gap-2">
          <span class="text-muted-foreground">sources</span>
          <span
            v-for="m in currentWindow.members"
            :key="m.harvestKey"
            class="rounded bg-muted px-1.5 py-0.5"
            :title="`${m.harvestKey} / run ${m.runId}`"
          >
            {{ sourceLabel(m.source) }} · <span class="font-mono">{{ num(m.retrievedRecords) }}</span>
            <span
              class="ml-1"
              :class="m.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'"
              :title="m.complete ? 'Every record the source reported was retrieved' : 'Fewer records were retrieved than the source reported'"
            >{{ m.complete ? '✓ complete' : '✗ incomplete' }}</span>
            <RouterLink
              v-if="consoleEnabled"
              :to="consoleRunLink(m.harvestKey, m.runId)"
              class="ml-1 text-muted-foreground underline decoration-dotted hover:text-foreground"
              title="Open this run's records in the console"
            >trace</RouterLink>
          </span>
        </div>
      </div>
      <p v-if="perWindow && currentWindow?.inProgress" class="mt-2 text-amber-700 dark:text-amber-400">
        ⚠ This window has not ended. Its counts are partial and will grow; they are not a decline.
      </p>
    </section>

    <p v-if="loading && !scope" class="p-6 text-sm text-muted-foreground">Loading…</p>

    <div v-else-if="error && !scope" class="m-6 rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
      <p class="font-medium">Nothing to show yet.</p>
      <p class="mt-1 text-xs">{{ error }}</p>
    </div>

    <template v-else-if="scope">
      <!-- The overview reads the timeline itself; the window pages need the family first. -->
      <RouterView v-if="!perWindow" />
      <p v-else-if="familyLoading" class="p-6 text-sm text-muted-foreground">
        Loading {{ currentWindow ? windowLabel(currentWindow) : 'the window' }}… a large year can take a few seconds the first time.
      </p>
      <div v-else-if="error" class="m-6 rounded border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
        <p class="font-medium">Could not load this window.</p>
        <p class="mt-1 text-xs">{{ error }}</p>
      </div>
      <RouterView v-else-if="family" />
    </template>
  </div>
</template>
