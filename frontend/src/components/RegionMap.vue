<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { geoConicEqualArea, geoPath } from 'd3'
import { regionOutlines, type RegionFeatures } from '@/lib/geo'

/**
 * IBRA bioregions shaded by one value each. Diverging values run −1…1 (alert below zero, good
 * above); sequential values run 0…max in one tone. Regions without a value are left blank, which
 * is a statement in itself: nothing assessed there. Mainland and Tasmania only — the external
 * territories' island bioregions would shrink the map to a speck.
 */
const props = withDefaults(
  defineProps<{
    values: Record<string, number | null | undefined>
    mode?: 'diverging' | 'sequential'
    tone?: 'alert' | 'good' | 'brand'
    max?: number
    /** Regions drawn with a heavy outline (flags, the current region). */
    outlined?: string[]
    tooltip?: (region: string, value: number | null | undefined) => string
    legend?: [string, string]
    /** What an unshaded region means on this map. */
    blankLabel?: string
    link?: boolean
    height?: number
  }>(),
  { mode: 'sequential', tone: 'brand', outlined: () => [], link: true, height: 420, blankLabel: 'not assessed' },
)

const router = useRouter()
const features = ref<RegionFeatures | null>(null)
const error = ref<string | null>(null)
const hover = ref<{ name: string; x: number; y: number; w: number } | null>(null)
onMounted(() =>
  regionOutlines()
    .then((f) => (features.value = f))
    .catch((e) => (error.value = String(e?.message ?? e))),
)

const WIDTH = 600
const projection = computed(() =>
  geoConicEqualArea()
    .parallels([-18, -36])
    .rotate([-134, 0])
    .fitExtent(
      [[4, 4], [WIDTH - 4, props.height - 4]],
      // Mainland Australia and Tasmania.
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[113, -9.6], [153.7, -9.6], [113, -43.7], [153.7, -43.7]] } },
    ),
)
const shapes = computed(() => {
  if (!features.value) return []
  const path = geoPath(projection.value)
  return features.value.features
    .filter((f) => {
      const [[x0, y0], [x1, y1]] = path.bounds(f)
      return x1 > 0 && x0 < WIDTH && y1 > 0 && y0 < props.height
    })
    .map((f) => ({ name: f.properties.name, d: path(f) ?? '' }))
})
const maxValue = computed(
  () => props.max ?? Math.max(1e-9, ...Object.values(props.values).filter((v): v is number => typeof v === 'number')),
)

function fill(name: string): string {
  const v = props.values[name]
  if (typeof v !== 'number') return 'var(--muted)'
  if (props.mode === 'diverging') {
    const t = Math.max(-1, Math.min(1, v))
    if (Math.abs(t) < 1e-9) return 'var(--card)'
    return `color-mix(in oklab, var(${t < 0 ? '--alert' : '--good'}) ${Math.round(12 + Math.abs(t) * 80)}%, var(--card))`
  }
  const t = Math.max(0, Math.min(1, v / maxValue.value))
  return t === 0 ? 'var(--card)' : `color-mix(in oklab, var(--${props.tone}) ${Math.round(12 + t * 80)}%, var(--card))`
}
const legendStops = computed(() =>
  props.mode === 'diverging' ? [-1, -0.5, 0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxValue.value),
)
const legendFill = (v: number) => {
  if (props.mode === 'diverging') {
    if (v === 0) return 'var(--card)'
    return `color-mix(in oklab, var(${v < 0 ? '--alert' : '--good'}) ${Math.round(12 + Math.abs(v) * 80)}%, var(--card))`
  }
  const t = v / maxValue.value
  return t === 0 ? 'var(--card)' : `color-mix(in oklab, var(--${props.tone}) ${Math.round(12 + t * 80)}%, var(--card))`
}

function move(e: MouseEvent, name: string) {
  const box = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
  hover.value = { name, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width }
}
const tip = computed(() => {
  if (!hover.value) return ''
  const v = props.values[hover.value.name]
  return props.tooltip ? props.tooltip(hover.value.name, v) : `${hover.value.name}${typeof v === 'number' ? `: ${v}` : ''}`
})
const open = (name: string) => props.link && router.push(`/regions/${encodeURIComponent(name)}`)
</script>

<template>
  <div class="relative">
    <p v-if="error" class="text-sm text-alert">Map unavailable: {{ error }}</p>
    <div v-else-if="!features" class="animate-pulse rounded-lg bg-muted" :style="{ aspectRatio: `${WIDTH} / ${height}` }" />
    <template v-else>
      <svg :viewBox="`0 0 ${WIDTH} ${height}`" class="w-full" role="img" aria-label="Map of IBRA bioregions" @mouseleave="hover = null">
        <path
          v-for="s in shapes"
          :key="s.name"
          :d="s.d"
          :style="{ fill: fill(s.name) }"
          class="stroke-border"
          :class="link && 'cursor-pointer hover:opacity-80'"
          stroke-width="0.6"
          @mousemove="move($event, s.name)"
          @click="open(s.name)"
        />
        <path
          v-for="s in shapes.filter((x) => outlined.includes(x.name))"
          :key="`o-${s.name}`"
          :d="s.d"
          fill="none"
          class="pointer-events-none stroke-foreground"
          stroke-width="1.8"
        />
      </svg>
      <div
        v-if="hover"
        class="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
        :style="hover.x < hover.w / 2 ? { left: `${hover.x + 12}px`, top: `${hover.y + 12}px` } : { right: `${hover.w - hover.x + 12}px`, top: `${hover.y + 12}px` }"
      >
        {{ tip }}
      </div>
      <div v-if="legend" class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{{ legend[0] }}</span>
        <span class="flex">
          <span v-for="v in legendStops" :key="v" class="h-3 w-6 border-y first:border-l last:border-r" :style="{ background: legendFill(v) }" />
        </span>
        <span>{{ legend[1] }}</span>
        <span class="ml-3 flex items-center gap-1"><span class="h-3 w-4 border bg-muted" /> {{ blankLabel }}</span>
      </div>
    </template>
  </div>
</template>
