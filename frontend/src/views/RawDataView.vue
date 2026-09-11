<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCorpusStore } from '@/stores/corpusStore'
import { getRawPageAPI, listPagesAPI } from '@/apis/corpusAPI'
import type { PagesResponse, RawPageResponse, SnapshotPageMeta } from '@/apis/corpusTypes'
import { highlightJson, prettyLines } from '@/lib/jsonHighlight'
import { bytes, num } from '@/lib/format'

/**
 * Page 1 — the raw data, exactly as the source returned it.
 *
 * Each entry in the sidebar is one API call. Its response was written to disk verbatim before
 * anything parsed it, so what is shown here is the frozen bytes rather than a re-serialisation
 * of what the platform made of them — which is the only version worth checking a mapping
 * against.
 *
 * This is also the one view where the outbound protections do not apply: the snapshot holds
 * precise coordinates and real observer identifiers, and redacting them would make a "raw
 * data" view misrepresent the source. That is defensible locally and not in a deployment, so
 * the backend gates it behind INGESTION_SERVE_RAW and the banner below says so plainly.
 */

const store = useCorpusStore()
const { harvestKey, runId, ready, manifest } = storeToRefs(store)

const pages = ref<PagesResponse | null>(null)
const selected = ref<SnapshotPageMeta | null>(null)
// shallowRef: an iNaturalist page body is ~20 MB of string and there is nothing in it for Vue
// to track.
const raw = shallowRef<RawPageResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** Whole response, or drill into a single record — one iNaturalist observation alone is ~5,000 lines. */
const scope = ref<'response' | 'record'>('response')
const recordIndex = ref(0)
const collapsedSlices = ref<Set<string>>(new Set())

async function loadPages() {
  if (!harvestKey.value || !runId.value) return
  pages.value = await listPagesAPI(harvestKey.value, runId.value)
  const first = pages.value.slices[0]?.pages[0]
  if (first) await select(first)
}

async function select(page: SnapshotPageMeta) {
  if (!harvestKey.value || !runId.value) return
  selected.value = page
  loading.value = true
  error.value = null
  recordIndex.value = 0
  try {
    raw.value = await getRawPageAPI(harvestKey.value, runId.value, page.file)
  } catch (e) {
    const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message
    error.value = message ?? (e instanceof Error ? e.message : String(e))
    raw.value = null
  } finally {
    loading.value = false
  }
}

function toggleSlice(key: string) {
  const next = new Set(collapsedSlices.value)
  next.has(key) ? next.delete(key) : next.add(key)
  collapsedSlices.value = next
}

watch([harvestKey, runId], () => void loadPages(), { immediate: true })

/** The parsed response, used only to slice out one record for the record scope. */
const parsed = computed<Record<string, unknown> | null>(() => {
  if (!raw.value) return null
  try {
    return JSON.parse(raw.value.body) as Record<string, unknown>
  } catch {
    return null
  }
})

/**
 * The record array sits under a source-specific key — `occurrences` for ALA, `results` for
 * iNaturalist. The backend reports which with the page list, so this view does not guess.
 */
const records = computed<unknown[]>(() => {
  const key = pages.value?.recordsKey
  const list = key ? parsed.value?.[key] : undefined
  return Array.isArray(list) ? list : []
})

const lines = computed<string[]>(() => {
  if (!raw.value) return []
  if (scope.value === 'record') {
    const record = records.value[recordIndex.value]
    return record === undefined ? [] : prettyLines(record)
  }
  // Re-indent the frozen body for reading. The bytes on disk are unchanged; only the
  // whitespace shown here differs, and the content hash is computed from the original.
  return parsed.value ? prettyLines(parsed.value) : raw.value.body.split('\n')
})

/**
 * Virtualised rendering.
 *
 * An iNaturalist page pretty-prints to close to a million lines, and a DOM row per line is
 * what hung the tab: the browser had to lay out two million cells before it could paint. Only
 * the rows inside the scroll viewport, plus a margin either side, exist at any moment, and
 * each is highlighted as it comes into view — so the cost of opening a response is its parse,
 * not its length. A fixed row height is what makes the arithmetic exact; lines never wrap
 * (whitespace-pre), so it holds.
 */
const ROW_PX = 18
const OVERSCAN = 30
const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

watch(viewport, (el, _previous, onCleanup) => {
  if (!el) return
  const observer = new ResizeObserver(([entry]) => {
    viewportHeight.value = entry?.contentRect.height ?? el.clientHeight
  })
  observer.observe(el)
  onCleanup(() => observer.disconnect())
})

function onScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}

/**
 * Browsers cap an element's height — Chrome at 2^24 px, about 16.7 million — and the largest
 * iNaturalist page at 18 px a line wants 17.7 million, so its last fifty thousand lines would
 * sit below a scrollbar that cannot reach them. Above a safe height the scroll track is
 * compressed: the scrollable element stays under the cap and the scroll offset is scaled up
 * into the true offset when choosing rows. At ~1.2× nobody notices; it only matters that the
 * end is reachable.
 */
const MAX_SCROLL_PX = 15_000_000
const totalHeight = computed(() => lines.value.length * ROW_PX)
const scrollHeight = computed(() => Math.min(totalHeight.value, MAX_SCROLL_PX))
const scrollScale = computed(() => {
  const track = scrollHeight.value - viewportHeight.value
  return totalHeight.value > scrollHeight.value && track > 0
    ? (totalHeight.value - viewportHeight.value) / track
    : 1
})
/** The scroll offset in true (uncompressed) pixels. */
const trueScrollTop = computed(() => scrollTop.value * scrollScale.value)

const firstRow = computed(() => Math.max(0, Math.floor(trueScrollTop.value / ROW_PX) - OVERSCAN))
const lastRow = computed(() =>
  Math.min(
    lines.value.length,
    Math.ceil((trueScrollTop.value + viewportHeight.value) / ROW_PX) + OVERSCAN,
  ),
)
/** Where the rendered block sits so that the row under the true offset lands at the viewport top. */
const rowsTop = computed(() => scrollTop.value - (trueScrollTop.value - firstRow.value * ROW_PX))
const visibleRows = computed(() => {
  const rows: { index: number; html: string }[] = []
  for (let i = firstRow.value; i < lastRow.value; i++) {
    rows.push({ index: i, html: highlightJson(lines.value[i] ?? '') })
  }
  return rows
})

/** Wide enough for the largest line number, so the gutter does not shift while scrolling. */
const gutterWidth = computed(() => `calc(${String(lines.value.length).length}ch + 1.5rem)`)

/** Back to the top whenever the content changes, so the offset never points past the end. */
watch(lines, () => {
  viewport.value?.scrollTo({ top: 0 })
  scrollTop.value = 0
})

async function copyToClipboard() {
  if (!raw.value) return
  const text =
    scope.value === 'record'
      ? JSON.stringify(records.value[recordIndex.value], null, 2)
      : raw.value.body
  await navigator.clipboard.writeText(text)
}
</script>

<template>
  <div v-if="ready" class="grid h-[calc(100vh-9.5rem)] grid-cols-1 lg:grid-cols-[20rem_1fr]">
    <!-- API calls -->
    <aside class="flex min-h-0 min-w-0 flex-col border-r border-border">
      <div class="border-b border-border p-3">
        <h2 class="text-sm font-semibold">API calls</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Each is one request to {{ manifest?.source ?? 'the source' }}, frozen verbatim.
          Grouped by the date slice the harvester partitioned the window into.
        </p>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-for="slice in pages?.slices ?? []" :key="slice.sliceKey">
          <button
            class="flex w-full items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-left hover:bg-muted"
            @click="toggleSlice(slice.sliceKey)"
          >
            <span class="font-mono text-[11px]">
              {{ collapsedSlices.has(slice.sliceKey) ? '▸' : '▾' }} {{ slice.sliceKey }}
            </span>
            <span class="shrink-0 text-[11px] text-muted-foreground">
              {{ num(slice.retrievedRecords) }} recs · {{ slice.pages.length }} calls
            </span>
          </button>

          <ul v-if="!collapsedSlices.has(slice.sliceKey)">
            <li v-for="page in slice.pages" :key="page.file">
              <button
                class="w-full border-b border-border px-3 py-1.5 text-left hover:bg-muted/60"
                :class="page.file === selected?.file ? 'bg-muted' : ''"
                @click="select(page)"
              >
                <div class="flex items-baseline justify-between gap-2 text-xs">
                  <span class="font-mono">offset {{ num(page.startIndex) }}</span>
                  <span class="shrink-0 text-[11px] text-muted-foreground">
                    {{ page.recordCount }} recs · {{ bytes(page.bytes) }}
                  </span>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </aside>

    <!-- Response -->
    <section class="flex min-h-0 min-w-0 flex-col">
      <div v-if="pages && !pages.serveRawResponses" class="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
        Raw responses are not being served (<code class="font-mono">INGESTION_SERVE_RAW=false</code>).
      </div>

      <template v-if="selected">
        <!-- Request metadata -->
        <div class="border-b border-border px-4 py-3">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span>
              <span class="text-muted-foreground">status</span>
              <span class="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{{ selected.status }}</span>
            </span>
            <span><span class="text-muted-foreground">records</span> <span class="ml-1 font-mono">{{ selected.recordCount }}</span></span>
            <span><span class="text-muted-foreground">size</span> <span class="ml-1 font-mono">{{ bytes(selected.bytes) }}</span></span>
            <span><span class="text-muted-foreground">took</span> <span class="ml-1 font-mono">{{ selected.durationMs }}ms</span></span>
            <span v-if="selected.attempts > 1" class="text-amber-700 dark:text-amber-400">
              {{ selected.attempts }} attempts
            </span>
            <span :title="selected.contentHash">
              <span class="text-muted-foreground">sha256</span>
              <span class="ml-1 font-mono">{{ selected.contentHash.slice(0, 12) }}</span>
            </span>
            <span><span class="text-muted-foreground">fetched</span> <span class="ml-1 font-mono">{{ selected.fetchedAt.slice(0, 19).replace('T', ' ') }}</span></span>
          </div>
          <p class="mt-2 break-all font-mono text-[11px] text-muted-foreground">
            GET {{ decodeURIComponent(selected.url) }}
          </p>
        </div>

        <!-- Viewer controls -->
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
          <div class="flex overflow-hidden rounded border border-border">
            <button
              class="px-2 py-0.5"
              :class="scope === 'response' ? 'bg-muted font-medium' : 'text-muted-foreground'"
              @click="scope = 'response'"
            >Whole response</button>
            <button
              class="border-l border-border px-2 py-0.5"
              :class="scope === 'record' ? 'bg-muted font-medium' : 'text-muted-foreground'"
              @click="scope = 'record'"
            >One record</button>
          </div>

          <label v-if="scope === 'record'" class="flex items-center gap-1.5 text-muted-foreground">
            record
            <select v-model.number="recordIndex" class="rounded border border-border bg-background px-1 py-0.5 font-mono">
              <option v-for="(_, i) in records" :key="i" :value="i">{{ i + 1 }} / {{ records.length }}</option>
            </select>
          </label>

          <span class="text-muted-foreground">{{ num(lines.length) }} lines</span>
          <button class="ml-auto text-muted-foreground underline" @click="copyToClipboard">Copy JSON</button>
        </div>

        <!-- The editor-style viewer. Only the rows in view are in the DOM; see the script. -->
        <div
          ref="viewport"
          class="min-h-0 flex-1 overflow-auto bg-[var(--code-bg)]"
          @scroll.passive="onScroll"
        >
          <p v-if="loading" class="p-4 text-xs text-muted-foreground">Loading…</p>
          <p v-else-if="error" class="p-4 text-xs text-rose-600 dark:text-rose-400">{{ error }}</p>
          <div
            v-else
            class="relative font-mono text-[11.5px]"
            :style="{ height: `${scrollHeight}px` }"
          >
            <div class="absolute left-0 w-max min-w-full" :style="{ top: `${rowsTop}px` }">
              <div
                v-for="row in visibleRows"
                :key="row.index"
                class="flex"
                :style="{ height: `${ROW_PX}px`, lineHeight: `${ROW_PX}px` }"
              >
                <span
                  class="sticky left-0 shrink-0 select-none border-r border-border/60 bg-[var(--code-bg)] px-2 text-right text-muted-foreground/60"
                  :style="{ width: gutterWidth }"
                >{{ row.index + 1 }}</span>
                <span class="whitespace-pre px-3" v-html="row.html || '&nbsp;'" />
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
/* A calm code surface in both themes; tokens follow the shadcn chart palette. */
section :deep(.tok-key) { color: var(--chart-3); }
section :deep(.tok-str) { color: var(--chart-2); }
section :deep(.tok-num) { color: var(--chart-1); }
section :deep(.tok-lit) { color: var(--chart-4); font-style: italic; }
</style>
