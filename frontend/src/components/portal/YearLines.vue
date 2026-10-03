<script setup lang="ts">
import { computed, ref } from 'vue'
import { niceTicks, useWidth } from '@/lib/chart'
import { num, pct } from '@/lib/format'

/**
 * A rate per year, one line per source, on one shared axis — rates are comparable across
 * sources where raw counts are not.
 *
 * A rate resting on a small denominator is drawn as a hollow point, so a year where a source
 * read fourteen remarks does not carry the same weight as one where it read four thousand.
 * The crosshair snaps to the nearest year and the readout lists every source at that year.
 */
export interface LinePoint {
  year: number
  /** A share, 0–1, or null where the source has nothing that year. */
  value: number | null
  /** The denominator behind the share. */
  n: number
  /** The denominator is too small to read much into. */
  weak: boolean
}

const props = withDefaults(
  defineProps<{
    years: number[]
    series: { key: string; label: string; color: string; points: LinePoint[] }[]
    height?: number
    /** What `n` counts, for the readout: "remarks read". */
    nLabel?: string
  }>(),
  { height: 200, nLabel: 'n' },
)

const root = ref<HTMLElement | null>(null)
const width = useWidth(root)

const M = { top: 12, right: 88, bottom: 22, left: 40 }

const allValues = computed(() => props.series.flatMap((s) => s.points.map((p) => p.value ?? 0)))
const ticks = computed(() => niceTicks(Math.max(...allValues.value, 0.01)))
const yMax = computed(() => ticks.value[ticks.value.length - 1] ?? 1)
const plotW = computed(() => Math.max(10, width.value - M.left - M.right))
const plotH = computed(() => props.height - M.top - M.bottom)
const baseline = computed(() => M.top + plotH.value)

const step = computed(() => (props.years.length > 1 ? plotW.value / (props.years.length - 1) : 0))
const x = (i: number) => M.left + (props.years.length > 1 ? step.value * i : plotW.value / 2)
const y = (v: number) => M.top + plotH.value * (1 - v / yMax.value)

const drawn = computed(() =>
  props.series.map((s) => {
    const pts = props.years.map((year, i) => {
      const p = s.points.find((q) => q.year === year)
      return { year, i, p, cx: x(i), cy: p && p.value !== null ? y(p.value) : null }
    })
    // Break the line where a year is missing rather than bridging it.
    let d = ''
    let pen = false
    for (const q of pts) {
      if (q.cy === null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${q.cx},${q.cy}`
      pen = true
    }
    const last = [...pts].reverse().find((q) => q.cy !== null) ?? null
    return { ...s, pts, d, last }
  }),
)

/** End labels only where they would not collide; the legend always carries identity. */
const endLabels = computed(() => {
  const ends = drawn.value.filter((s) => s.last).map((s) => ({ key: s.key, label: s.label, y: s.last!.cy!, x: s.last!.cx }))
  const sorted = [...ends].sort((a, b) => a.y - b.y)
  const collide = sorted.some((e, i) => i > 0 && e.y - sorted[i - 1]!.y < 12)
  return collide ? [] : ends
})

const hover = ref<number | null>(null)

function onMove(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  const px = event.clientX - rect.left
  if (props.years.length < 2) {
    hover.value = 0
    return
  }
  hover.value = Math.max(0, Math.min(props.years.length - 1, Math.round((px - M.left) / step.value)))
}

const readout = computed(() => {
  if (hover.value === null) return null
  const i = hover.value
  return {
    year: props.years[i],
    cx: x(i),
    rows: drawn.value.map((s) => ({ key: s.key, label: s.label, color: s.color, p: s.pts[i]?.p ?? null })),
  }
})
</script>

<template>
  <figure class="min-w-0">
    <!-- Legend: a line key per series, mirroring the mark. -->
    <figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span v-for="s in series" :key="s.key" class="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" :stroke="s.color" stroke-width="2" stroke-linecap="round" /></svg>
        {{ s.label }}
      </span>
      <span class="flex items-center gap-1.5 text-muted-foreground">
        <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="var(--background)" stroke="currentColor" stroke-width="1.5" /></svg>
        small sample
      </span>
    </figcaption>

    <div ref="root" class="relative mt-2">
      <svg
        :width="width"
        :height="height"
        class="block overflow-visible"
        role="img"
        aria-label="Rate per year by source"
        @pointermove="onMove"
        @pointerleave="hover = null"
      >
        <g>
          <template v-for="t in ticks" :key="t">
            <line :x1="M.left" :x2="M.left + plotW" :y1="y(t)" :y2="y(t)" :stroke="t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'" stroke-width="1" />
            <text :x="M.left - 6" :y="y(t)" dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[10px] tabular-nums">{{ pct(t, 0) }}</text>
          </template>
        </g>
        <g>
          <text
            v-for="(yr, i) in years"
            v-show="step >= 34 || i % 2 === (years.length - 1) % 2"
            :key="yr"
            :x="x(i)"
            :y="baseline + 14"
            text-anchor="middle"
            class="fill-muted-foreground text-[10px] tabular-nums"
          >{{ yr }}</text>
        </g>

        <line v-if="readout" :x1="readout.cx" :x2="readout.cx" :y1="M.top" :y2="baseline" stroke="var(--chart-axis)" stroke-width="1" />

        <g v-for="s in drawn" :key="s.key">
          <path :d="s.d" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <template v-for="q in s.pts" :key="q.year">
            <circle
              v-if="q.cy !== null"
              :cx="q.cx"
              :cy="q.cy"
              r="4"
              :fill="q.p?.weak ? 'var(--background)' : s.color"
              :stroke="q.p?.weak ? s.color : 'var(--background)'"
              stroke-width="2"
            />
          </template>
        </g>

        <text
          v-for="e in endLabels"
          :key="e.key"
          :x="e.x + 10"
          :y="e.y"
          dy="0.32em"
          class="fill-foreground text-[11px]"
        >{{ e.label }}</text>
      </svg>

      <div
        v-if="readout"
        class="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded border border-border bg-background px-2 py-1.5 text-[11px] shadow-sm"
        :style="readout.cx > width / 2 ? { right: `${width - readout.cx + 10}px` } : { left: `${readout.cx + 10}px` }"
      >
        <div class="mb-1 text-muted-foreground">{{ readout.year }}</div>
        <div v-for="r in readout.rows" :key="r.key" class="flex items-center gap-2">
          <svg width="12" height="6" aria-hidden="true"><line x1="0" x2="12" y1="3" y2="3" :stroke="r.color" stroke-width="2" stroke-linecap="round" /></svg>
          <span class="font-semibold tabular-nums">{{ r.p && r.p.value !== null ? pct(r.p.value) : '—' }}</span>
          <span class="text-muted-foreground">{{ r.label }}<template v-if="r.p"> · {{ num(r.p.n) }} {{ nLabel }}</template></span>
        </div>
      </div>
    </div>
  </figure>
</template>
