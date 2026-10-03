<script setup lang="ts">
import { computed, ref } from 'vue'
import { columnPath, compact, niceTicks, useWidth } from '@/lib/chart'
import { num } from '@/lib/format'

/**
 * One series, one column per year, on its own axis.
 *
 * Used as a small multiple — one per source — because the sources differ by two orders of
 * magnitude, and on a shared axis the smaller one would be a row of slivers. Each panel is
 * labelled with its own scale. A year still in progress is drawn faded, so a partial count
 * does not read as a fall.
 */
const props = withDefaults(
  defineProps<{
    label: string
    color: string
    points: { year: number; value: number; partial: boolean; note?: string }[]
    height?: number
  }>(),
  { height: 168 },
)

const root = ref<HTMLElement | null>(null)
const width = useWidth(root)

const M = { top: 18, right: 8, bottom: 22, left: 40 }

const ticks = computed(() => niceTicks(Math.max(...props.points.map((p) => p.value), 0)))
const yMax = computed(() => ticks.value[ticks.value.length - 1] ?? 1)
const plotW = computed(() => Math.max(10, width.value - M.left - M.right))
const plotH = computed(() => props.height - M.top - M.bottom)
const band = computed(() => plotW.value / Math.max(1, props.points.length))
const barW = computed(() => Math.min(24, band.value * 0.6))
const baseline = computed(() => M.top + plotH.value)

const y = (v: number) => M.top + plotH.value * (1 - v / yMax.value)

const bars = computed(() =>
  props.points.map((p, i) => {
    const cx = M.left + band.value * (i + 0.5)
    return { ...p, i, cx, x: cx - barW.value / 2, top: y(p.value), path: columnPath(cx - barW.value / 2, y(p.value), barW.value, baseline.value) }
  }),
)

/** Label sparingly: the largest year only. The axis, the tooltip and the table carry the rest. */
const peak = computed(() => bars.value.reduce((best, b) => (b.value > (best?.value ?? -1) ? b : best), bars.value[0]))

/** Years to label on the x axis: all of them when there is room, every other one when not. */
const showYear = (i: number) => band.value >= 34 || i % 2 === (props.points.length - 1) % 2

const hover = ref<number | null>(null)
const hovered = computed(() => (hover.value === null ? null : bars.value[hover.value] ?? null))
</script>

<template>
  <figure class="min-w-0">
    <figcaption class="flex items-center gap-2 text-xs">
      <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: color }" />
      <span class="font-medium">{{ label }}</span>
    </figcaption>
    <div ref="root" class="relative mt-1" @pointerleave="hover = null">
      <svg :width="width" :height="height" class="block overflow-visible" role="img" :aria-label="`${label}, records per year`">
        <!-- Grid and ticks -->
        <g>
          <template v-for="t in ticks" :key="t">
            <line :x1="M.left" :x2="M.left + plotW" :y1="y(t)" :y2="y(t)" :stroke="t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'" stroke-width="1" />
            <text :x="M.left - 6" :y="y(t)" dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[10px] tabular-nums">{{ compact(t) }}</text>
          </template>
        </g>
        <!-- Columns -->
        <g>
          <path
            v-for="b in bars"
            :key="b.year"
            :d="b.path"
            :fill="color"
            :fill-opacity="b.partial ? 0.35 : hover === b.i ? 0.8 : 1"
          />
        </g>
        <!-- The one direct label -->
        <text
          v-if="peak && peak.value > 0"
          :x="peak.cx"
          :y="peak.top - 5"
          text-anchor="middle"
          class="fill-foreground text-[10px] tabular-nums"
        >{{ num(peak.value) }}</text>
        <!-- Years -->
        <g>
          <text
            v-for="b in bars"
            v-show="showYear(b.i)"
            :key="b.year"
            :x="b.cx"
            :y="baseline + 14"
            text-anchor="middle"
            class="fill-muted-foreground text-[10px] tabular-nums"
          >{{ b.year }}</text>
        </g>
        <!-- Hit targets: the whole band, not just the painted column -->
        <rect
          v-for="b in bars"
          :key="`hit-${b.year}`"
          :x="b.cx - band / 2"
          :y="M.top"
          :width="band"
          :height="plotH"
          fill="transparent"
          tabindex="0"
          class="outline-none"
          @pointerenter="hover = b.i"
          @focus="hover = b.i"
          @blur="hover = null"
        />
      </svg>

      <div
        v-if="hovered"
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-border bg-background px-2 py-1 text-[11px] shadow-sm"
        :style="{ left: `${hovered.cx}px`, top: `${Math.max(0, hovered.top - 6)}px` }"
      >
        <div class="font-semibold tabular-nums">{{ num(hovered.value) }}</div>
        <div class="text-muted-foreground">{{ label }} · {{ hovered.year }}<template v-if="hovered.partial"> · partial year</template></div>
        <div v-if="hovered.note" class="text-muted-foreground">{{ hovered.note }}</div>
      </div>
    </div>
  </figure>
</template>
