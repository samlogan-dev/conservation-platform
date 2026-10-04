<script setup lang="ts">
import { computed, ref } from 'vue'
import { scaleBand, scaleLinear } from 'd3'
import { fmt } from '@/lib/insights'

/**
 * Counts per period as bars, with an optional highlighted part of each bar (e.g. wild records
 * within all records) and shaded bands for the comparison windows. Periods are labels such as
 * "2019" or "2019-04"; bands match on them as strings, so "2017" ≤ x ≤ "2019" works for both.
 */
const props = withDefaults(
  defineProps<{
    points: { x: string; y: number; part?: number }[]
    bands?: { from: string; to: string; label: string; tone?: 'brand' | 'warn' }[]
    yLabel?: string
    partLabel?: string
    restLabel?: string
    height?: number
    /** Show every nth x label. */
    labelEvery?: number
    xLabel?: (x: string) => string
  }>(),
  { bands: () => [], height: 200, labelEvery: 1 },
)

const W = 640
const M = { top: 18, right: 8, bottom: 22, left: 48 }
const x = computed(() => scaleBand<string>().domain(props.points.map((p) => p.x)).range([M.left, W - M.right]).padding(0.15))
const y = computed(() =>
  scaleLinear()
    .domain([0, Math.max(1, ...props.points.map((p) => p.y))])
    .nice()
    .range([props.height - M.bottom, M.top]),
)
const ticks = computed(() => y.value.ticks(4))
const bandRects = computed(() =>
  props.bands
    .map((b) => {
      const inBand = props.points.filter((p) => p.x >= b.from && p.x <= b.to + '￿')
      if (!inBand.length) return null
      const x0 = x.value(inBand[0]!.x)!
      const x1 = x.value(inBand[inBand.length - 1]!.x)! + x.value.bandwidth()
      return { ...b, x0, x1 }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null),
)
const hover = ref<{ x: string; y: number; part?: number } | null>(null)
</script>

<template>
  <div>
    <svg :viewBox="`0 0 ${W} ${height}`" class="w-full" role="img" :aria-label="yLabel ?? 'Bar chart'" @mouseleave="hover = null">
      <g v-for="b in bandRects" :key="b.label">
        <rect :x="b.x0 - 2" :y="M.top - 14" :width="b.x1 - b.x0 + 4" :height="height - M.bottom - M.top + 14"
              :style="{ fill: `var(--${b.tone ?? 'brand'}-soft, var(--muted))` }" :class="!b.tone && 'opacity-60'" />
        <text :x="(b.x0 + b.x1) / 2" :y="M.top - 4" text-anchor="middle" class="fill-muted-foreground text-[10px]">{{ b.label }}</text>
      </g>
      <g v-for="t in ticks" :key="t">
        <line :x1="M.left" :x2="W - M.right" :y1="y(t)" :y2="y(t)" class="stroke-border" stroke-dasharray="2 3" />
        <text :x="M.left - 6" :y="y(t)" dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[10px]">{{ fmt(t) }}</text>
      </g>
      <g v-for="(p, i) in points" :key="p.x" @mouseenter="hover = p">
        <rect :x="x(p.x)" :y="y(p.y)" :width="x.bandwidth()" :height="y(0) - y(p.y)"
              :style="{ fill: p.part !== undefined ? 'var(--muted-foreground)' : 'var(--brand)', opacity: p.part !== undefined ? 0.35 : 0.85 }" />
        <rect v-if="p.part !== undefined" :x="x(p.x)" :y="y(p.part)" :width="x.bandwidth()" :height="y(0) - y(p.part)" style="fill: var(--brand)" />
        <rect :x="x(p.x)" :y="M.top" :width="x.bandwidth()" :height="height - M.bottom - M.top" fill="transparent" />
        <text v-if="i % labelEvery === 0" :x="x(p.x)! + x.bandwidth() / 2" :y="height - 6" text-anchor="middle" class="fill-muted-foreground text-[10px]">
          {{ xLabel ? xLabel(p.x) : p.x }}
        </text>
      </g>
    </svg>
    <p class="h-4 text-xs text-muted-foreground">
      <template v-if="hover">
        {{ hover.x }}: {{ fmt(hover.y) }} {{ yLabel ?? '' }}<template v-if="hover.part !== undefined">, of which {{ fmt(hover.part) }} {{ partLabel }}</template>
      </template>
      <template v-else-if="partLabel">
        <span class="mr-1 inline-block h-2.5 w-2.5 align-middle" style="background: var(--brand)" />{{ partLabel }}
        <span class="ml-3 mr-1 inline-block h-2.5 w-2.5 align-middle opacity-35" style="background: var(--muted-foreground)" />{{ restLabel ?? 'other' }}
      </template>
    </p>
  </div>
</template>
