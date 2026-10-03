<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useSyncStore, type LanePhase, type LaneState, type SliceProgress } from '@/stores/syncStore'
import { useCorpusStore } from '@/stores/corpusStore'
import { getLivePageAPI } from '@/apis/syncAPI'
import type { SnapshotPageMeta } from '@/apis/corpusTypes'
import { highlightJson, prettyLines } from '@/lib/jsonHighlight'
import { bytes, num, shortHash } from '@/lib/format'

/**
 * The Run page: harvest one window from every source and watch it land.
 *
 * Each source is a lane. The lane draws exactly what the harvester does — count the window,
 * partition it into slices under the source's cap (ALA halves any slice over 4,500), page each
 * slice, reconcile it, then adapt and keyword-classify the new run. A call appears here only
 * once its response is frozen on disk, so any call can be opened while the run is going.
 */

const sync = useSyncStore()
const corpus = useCorpusStore()
const router = useRouter()
const { enabled, windows, job, status, lanes, running, connection, error, minRequestIntervalMs } = storeToRefs(sync)

const windowKey = ref<string>('')

onMounted(async () => {
  await sync.load()
  // Default to the window of the run being read elsewhere, else the newest.
  const current = windows.value.find((w) => w.lanes.some((l) => l.harvestKey === corpus.harvestKey))
  windowKey.value = job.value?.window.key ?? current?.key ?? windows.value[0]?.key ?? ''
})

const selectedWindow = computed(() => windows.value.find((w) => w.key === windowKey.value) ?? null)

/** Lanes run in parallel, so the slowest one sets the time. Only the polite floor is known in advance. */
const estimate = computed(() => {
  const w = selectedWindow.value
  if (!w || w.lanes.some((l) => !l.lastRun)) return null
  const requests = w.lanes.map((l) => l.lastRun!.requestCount)
  return {
    requests: requests.reduce((a, b) => a + b, 0),
    seconds: Math.max(...requests) * (minRequestIntervalMs.value / 1000),
  }
})

const duration = (seconds: number): string =>
  seconds < 90 ? `${Math.round(seconds)} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`

// --- Elapsed clock ---
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(timer))
const elapsed = computed(() => {
  if (!job.value) return null
  const end = sync.finishedAt ? Date.parse(sync.finishedAt) : now.value
  return Math.max(0, (end - Date.parse(job.value.startedAt)) / 1000)
})

const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function run() {
  if (!windowKey.value) return
  preview.value = null
  await sync.start(windowKey.value)
}

// --- Lane helpers ---
const STEPS: { phase: LanePhase; label: string }[] = [
  { phase: 'counting', label: 'Count' },
  { phase: 'paging', label: 'Page' },
  { phase: 'adapting', label: 'Adapt' },
  { phase: 'classifying', label: 'Classify' },
  { phase: 'done', label: 'Done' },
]
const ORDER: LanePhase[] = ['waiting', 'counting', 'paging', 'adapting', 'classifying', 'done']

function stepState(lane: LaneState, step: LanePhase): 'done' | 'active' | 'todo' {
  if (lane.phase === 'failed' || lane.phase === 'cancelled') return 'todo'
  const at = ORDER.indexOf(lane.phase)
  const idx = ORDER.indexOf(step)
  if (lane.phase === 'done' || at > idx) return 'done'
  return at === idx ? 'active' : 'todo'
}

const PHASE_TEXT: Record<LanePhase, string> = {
  waiting: 'waiting',
  counting: 'counting slices',
  paging: 'fetching pages',
  adapting: 'mapping to canonical records',
  classifying: 'keyword classification',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}

function progress(lane: LaneState): number {
  if (!lane.expected) return lane.phase === 'done' ? 1 : 0
  return Math.min(1, lane.retrieved / lane.expected)
}

/** Records accounted for by slices counted so far — what the counting phase is filling in. */
const plannedRecords = (lane: LaneState) => lane.slices.reduce((a, s) => a + s.expected, 0)

const MONTH = (d: Date) => d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })
function sliceLabel(key: string): string {
  const [s, e] = key.split('_')
  if (!s || !e) return key
  const sd = new Date(`${s}T00:00:00Z`)
  const ed = new Date(`${e}T00:00:00Z`)
  if (s.endsWith('-01-01') && e.endsWith('-12-31') && s.slice(0, 4) === e.slice(0, 4)) return `whole year (${s.slice(0, 4)})`
  if (s.slice(0, 7) === e.slice(0, 7)) {
    const lastDay = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() + 1, 0)).getUTCDate()
    if (sd.getUTCDate() === 1 && ed.getUTCDate() === lastDay) return MONTH(sd)
    return sd.getUTCDate() === ed.getUTCDate() ? `${sd.getUTCDate()} ${MONTH(sd)}` : `${sd.getUTCDate()}–${ed.getUTCDate()} ${MONTH(sd)}`
  }
  return `${sd.getUTCDate()} ${MONTH(sd)} – ${ed.getUTCDate()} ${MONTH(ed)}`
}

const SLICE_CLASS: Record<SliceProgress['state'], string> = {
  planned: 'border-border bg-muted/40',
  paging: 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40',
  done: 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  mismatch: 'border-rose-400 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40',
  empty: 'border-dashed border-border text-muted-foreground',
}

function delta(lane: LaneState): number | null {
  if (!lane.previous || !lane.harvested) return null
  return lane.harvested.retrievedRecords - lane.previous.retrievedRecords
}

async function openRun(lane: LaneState) {
  if (!lane.runId) return
  await corpus.refreshHarvests()
  await corpus.selectRun(lane.harvestKey, lane.runId)
  await router.push('/console')
}

// --- Preview: open any call that has landed ---
const preview = ref<{ lane: LaneState; page: SnapshotPageMeta } | null>(null)
const previewRecords = shallowRef<unknown[]>([])
const previewIndex = ref(0)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const PREVIEW_LINES = 400

async function openCall(lane: LaneState, page: SnapshotPageMeta) {
  if (!job.value) return
  preview.value = { lane, page }
  previewIndex.value = 0
  previewRecords.value = []
  previewError.value = null
  previewLoading.value = true
  try {
    const live = await getLivePageAPI(job.value.id, lane.harvestKey, page.file)
    const parsed = JSON.parse(live.body) as Record<string, unknown>
    const list = parsed[live.recordsKey]
    previewRecords.value = Array.isArray(list) ? list : []
  } catch (e) {
    const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message
    previewError.value = message ?? (e instanceof Error ? e.message : String(e))
  } finally {
    previewLoading.value = false
  }
}

const previewLines = computed(() => {
  const record = previewRecords.value[previewIndex.value]
  return record === undefined ? [] : prettyLines(record)
})

// A new job clears whatever was being previewed from the last one.
watch(() => job.value?.id, () => (preview.value = null))
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5 p-6">
    <!-- Controls -->
    <section class="rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <h2 class="text-sm font-semibold">Run a harvest</h2>
          <p class="mt-1 max-w-xl text-xs text-muted-foreground">
            Pulls one window from every source side by side, freezing each response as it arrives, then maps
            and keyword-classifies the new runs. Requests are held to ≥{{ minRequestIntervalMs }} ms apart per host.
            Each press makes a new run; earlier runs are kept.
          </p>
        </div>

        <label class="ml-auto flex flex-col gap-1 text-xs text-muted-foreground">
          window
          <select
            v-model="windowKey"
            :disabled="running"
            class="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          >
            <option v-for="w in windows" :key="w.key" :value="w.key">
              {{ w.label }} — {{ w.lanes.map((l) => `${l.source} ${l.lastRun ? num(l.lastRun.retrievedRecords) : '—'}`).join(' · ') }}
            </option>
          </select>
        </label>

        <button
          v-if="!running"
          class="rounded bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40"
          :disabled="!enabled || !windowKey"
          @click="run"
        >▶ Run</button>
        <button
          v-else
          class="rounded border border-rose-300 px-4 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
          @click="sync.cancel()"
        >■ Cancel</button>
      </div>

      <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span v-if="selectedWindow">
          scope <span class="font-mono text-foreground">{{ selectedWindow.speciesKey }} · {{ selectedWindow.regionKey }} · {{ selectedWindow.startDate }} → {{ selectedWindow.endDate }}</span>
        </span>
        <span v-if="estimate && !running">
          last time <span class="font-mono text-foreground">{{ num(estimate.requests) }}</span> requests — expect at least
          <span class="font-mono text-foreground">{{ duration(estimate.seconds) }}</span>
        </span>
        <span v-if="!enabled" class="text-amber-700 dark:text-amber-400">
          Starting harvests from the dashboard is disabled (INGESTION_ALLOW_UI_HARVEST=false).
        </span>
      </div>
      <p v-if="error" class="mt-2 text-xs text-rose-600 dark:text-rose-400">{{ error }}</p>
    </section>

    <!-- The job -->
    <template v-if="job">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span class="font-semibold">{{ job.window.label }}</span>
        <span
          class="rounded px-1.5 py-0.5 font-medium"
          :class="{
            'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200': status === 'running',
            'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200': status === 'finished',
            'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200': status === 'failed',
            'bg-muted text-muted-foreground': status === 'cancelled',
          }"
        >
          <span v-if="status === 'running'" class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500 align-middle" />{{ status }}
        </span>
        <span v-if="elapsed !== null" class="font-mono">{{ clock(elapsed) }}</span>
        <span class="text-muted-foreground">sync {{ job.id }}</span>
        <span v-if="connection === 'lost'" class="text-rose-600 dark:text-rose-400">
          lost the server — if it restarted (e.g. a saved backend file), the sync ended with it
        </span>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="lane in lanes" :key="lane.harvestKey" class="flex min-w-0 flex-col rounded-lg border border-border">
          <!-- Lane header -->
          <header class="border-b border-border px-4 py-3">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-semibold">{{ lane.label }}</h3>
              <span class="font-mono text-[11px] text-muted-foreground">{{ lane.harvestKey }}</span>
            </div>
            <ol class="mt-2 flex items-center gap-1 text-[11px]">
              <li v-for="(step, i) in STEPS" :key="step.phase" class="flex items-center gap-1">
                <span v-if="i > 0" class="text-muted-foreground/50">→</span>
                <span
                  class="rounded px-1.5 py-0.5"
                  :class="{
                    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200': stepState(lane, step.phase) === 'done',
                    'animate-pulse bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200': stepState(lane, step.phase) === 'active',
                    'text-muted-foreground': stepState(lane, step.phase) === 'todo',
                  }"
                >{{ step.label }}</span>
              </li>
              <li v-if="lane.phase === 'failed' || lane.phase === 'cancelled'" class="ml-2 font-medium text-rose-600 dark:text-rose-400">{{ lane.phase }}</li>
            </ol>
          </header>

          <!-- Numbers -->
          <div class="space-y-2 px-4 py-3">
            <div class="flex items-baseline justify-between gap-3">
              <div>
                <span class="font-mono text-2xl tabular-nums">{{ num(lane.retrieved) }}</span>
                <span class="ml-1 text-sm text-muted-foreground">/ {{ lane.expected === null ? '…' : num(lane.expected) }} records</span>
              </div>
              <span class="text-xs text-muted-foreground">
                {{ num(lane.calls.length) }} pages · {{ bytes(lane.bytes) }}
              </span>
            </div>
            <div class="h-1.5 overflow-hidden rounded bg-muted">
              <div
                class="h-full rounded bg-[var(--chart-2)] transition-[width] duration-500"
                :style="{ width: `${progress(lane) * 100}%` }"
              />
            </div>
            <p class="text-xs text-muted-foreground">
              {{ PHASE_TEXT[lane.phase] }}
              <template v-if="lane.phase === 'counting' && lane.expected">
                — {{ lane.slices.length }} slices, {{ num(plannedRecords(lane)) }} of {{ num(lane.expected) }} records placed
              </template>
              <template v-if="lane.phase === 'adapting' && lane.lastLog"> — {{ lane.lastLog }}</template>
            </p>
            <p v-if="lane.error" class="text-xs text-rose-600 dark:text-rose-400">{{ lane.error }}</p>
          </div>

          <!-- Slices -->
          <div v-if="lane.slices.length" class="border-t border-border px-4 py-3">
            <p class="mb-2 text-[11px] text-muted-foreground">
              slices — each counted before paging, reconciled after
            </p>
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="s in lane.slices"
                :key="s.sliceKey"
                class="relative min-w-[5.5rem] overflow-hidden rounded border px-2 py-1 text-[11px] transition-colors"
                :class="SLICE_CLASS[s.state]"
                :title="`${s.sliceKey}: ${s.retrieved}/${s.expected} records in ${s.pages} page(s)`"
              >
                <div
                  v-if="s.state === 'paging'"
                  class="absolute inset-y-0 left-0 bg-sky-200/60 transition-[width] duration-300 dark:bg-sky-800/40"
                  :style="{ width: `${s.expected ? (s.retrieved / s.expected) * 100 : 0}%` }"
                />
                <div class="relative">
                  <div class="font-medium">{{ sliceLabel(s.sliceKey) }}</div>
                  <div class="font-mono text-muted-foreground">
                    <template v-if="s.state === 'empty'">0</template>
                    <template v-else>{{ num(s.retrieved) }}/{{ num(s.expected) }}</template>
                    <span v-if="s.state === 'done'" class="text-emerald-600 dark:text-emerald-400"> ✓</span>
                    <span v-if="s.state === 'mismatch'" class="text-rose-600 dark:text-rose-400"> ✗</span>
                  </div>
                </div>
              </div>
            </div>
            <ul v-if="lane.splits.length" class="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              <li v-for="sp in lane.splits" :key="sp.sliceKey">
                ↯ {{ sliceLabel(sp.sliceKey) }} held {{ num(sp.expected) }} — over the 5,000-record cap's 4,500 margin, halved into
                {{ sliceLabel(sp.into[0]) }} and {{ sliceLabel(sp.into[1]) }}
              </li>
            </ul>
          </div>

          <!-- Calls -->
          <div class="border-t border-border">
            <p class="px-4 pt-3 text-[11px] text-muted-foreground">API calls, newest first — click to open what came back</p>
            <ul class="mt-1 max-h-56 overflow-y-auto">
              <li v-for="page in lane.calls" :key="page.file">
                <button
                  class="grid w-full grid-cols-[1fr_auto] gap-2 border-t border-border/60 px-4 py-1 text-left text-xs hover:bg-muted/60"
                  :class="preview?.page.file === page.file && preview?.lane.harvestKey === lane.harvestKey ? 'bg-muted' : ''"
                  @click="openCall(lane, page)"
                >
                  <span class="truncate font-mono">
                    <span class="text-muted-foreground">{{ sliceLabel(page.sliceKey) }}</span>
                    · {{ lane.source === 'inaturalist' ? 'after id' : 'offset' }} {{ num(page.startIndex) }}
                  </span>
                  <span class="font-mono text-[11px] text-muted-foreground">
                    <span class="rounded bg-emerald-100 px-1 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{{ page.status }}</span>
                    {{ page.recordCount }} recs · {{ page.durationMs }} ms · {{ bytes(page.bytes) }}
                    <span v-if="page.attempts > 1" class="text-amber-700 dark:text-amber-400">· {{ page.attempts }} tries</span>
                  </span>
                </button>
              </li>
              <li v-if="!lane.calls.length" class="px-4 py-2 text-xs text-muted-foreground">
                {{ lane.phase === 'waiting' || lane.phase === 'counting' ? 'Counting first — pages follow once every slice is under the cap.' : 'No pages.' }}
              </li>
            </ul>
          </div>

          <!-- Result -->
          <footer v-if="lane.harvested" class="mt-auto space-y-1 border-t border-border bg-muted/30 px-4 py-3 text-xs">
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                complete
                <span :class="lane.harvested.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                  {{ lane.harvested.complete ? '✓ every slice balanced' : '✗ incomplete' }}
                </span>
              </span>
              <span :title="lane.harvested.corpusHash">hash <span class="font-mono">{{ shortHash(lane.harvested.corpusHash) }}</span></span>
              <span>{{ num(lane.harvested.requestCount) }} requests</span>
            </div>
            <p v-if="lane.previous">
              vs last run ({{ lane.previous.runId.slice(0, 10) }}):
              <span class="font-mono">{{ num(lane.previous.retrievedRecords) }} → {{ num(lane.harvested.retrievedRecords) }}</span>
              <span v-if="delta(lane)" class="ml-1 font-medium" :class="delta(lane)! > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'">
                ({{ delta(lane)! > 0 ? '+' : '' }}{{ num(delta(lane)!) }})
              </span>
              <span class="text-muted-foreground">
                · {{ lane.previous.corpusHash === lane.harvested.corpusHash ? 'byte-identical' : 'data changed' }}
              </span>
            </p>
            <p v-if="lane.adapted">
              {{ num(lane.adapted.recordsAdapted) }} canonical records ({{ num(lane.adapted.recordsValid) }} valid, {{ num(lane.adapted.duplicates) }} duplicates)<template v-if="lane.labelled !== null"> · {{ num(lane.labelled) }} text fields labelled (keyword)</template>
            </p>
            <p v-for="w in lane.harvested.warnings" :key="w" class="text-amber-700 dark:text-amber-400">⚠ {{ w }}</p>
            <button
              v-if="lane.phase === 'done'"
              class="mt-1 rounded border border-border bg-background px-2.5 py-1 font-medium hover:bg-muted"
              @click="openRun(lane)"
            >Open this run in Raw data →</button>
          </footer>
        </article>
      </div>

      <!-- Preview -->
      <section v-if="preview" class="rounded-lg border border-border">
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
          <span class="font-semibold">{{ preview.lane.label }}</span>
          <span class="font-mono text-muted-foreground">{{ preview.page.file }}</span>
          <label v-if="previewRecords.length" class="flex items-center gap-1.5 text-muted-foreground">
            record
            <select v-model.number="previewIndex" class="rounded border border-border bg-background px-1 py-0.5 font-mono">
              <option v-for="(_, i) in previewRecords" :key="i" :value="i">{{ i + 1 }} / {{ previewRecords.length }}</option>
            </select>
          </label>
          <button class="ml-auto text-muted-foreground underline" @click="preview = null">close</button>
        </div>
        <p class="break-all px-4 pt-2 font-mono text-[11px] text-muted-foreground">GET {{ decodeURIComponent(preview.page.url) }}</p>
        <p v-if="previewLoading" class="p-4 text-xs text-muted-foreground">Loading…</p>
        <p v-else-if="previewError" class="p-4 text-xs text-rose-600 dark:text-rose-400">{{ previewError }}</p>
        <pre
          v-else
          class="raw mt-2 max-h-[28rem] overflow-auto bg-[var(--code-bg)] px-4 py-2 font-mono text-[11.5px] leading-[18px]"
        ><template v-for="(line, i) in previewLines.slice(0, PREVIEW_LINES)" :key="i"><span v-html="highlightJson(line)" />
</template></pre>
        <p v-if="previewLines.length > PREVIEW_LINES" class="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          first {{ PREVIEW_LINES }} of {{ num(previewLines.length) }} lines — the whole response is on the Raw data page once the run finishes
        </p>
      </section>
    </template>

    <p v-else-if="enabled" class="text-xs text-muted-foreground">
      Pick a window and press Run. The current year is the quick one to demonstrate; a full ALA year like 2024
      is around 850 requests.
    </p>
  </div>
</template>

<style scoped>
.raw :deep(.tok-key) { color: var(--chart-3); }
.raw :deep(.tok-str) { color: var(--chart-2); }
.raw :deep(.tok-num) { color: var(--chart-1); }
.raw :deep(.tok-lit) { color: var(--chart-4); font-style: italic; }
</style>
