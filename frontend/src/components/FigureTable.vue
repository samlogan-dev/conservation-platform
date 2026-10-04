<script setup lang="ts">
import { computed } from 'vue'

/** Any nested figures or confidence object, flattened to readable rows. */
const props = defineProps<{ data: Record<string, any>; hide?: string[] }>()

const rows = computed(() => {
  const out: { key: string; value: string }[] = []
  const walk = (o: unknown, prefix: string) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) walk(v, prefix ? `${prefix} · ${k}` : k)
      return
    }
    if (props.hide?.some((h) => prefix === h || prefix.startsWith(`${h} ·`))) return
    const value = Array.isArray(o) ? (o.length > 8 ? `${o.length} items` : o.join(', ')) : o === null ? '—' : String(o)
    out.push({ key: prefix.replaceAll('_', ' '), value })
  }
  walk(props.data, '')
  return out
})
</script>

<template>
  <dl class="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-1 text-xs">
    <template v-for="row in rows" :key="row.key">
      <dt class="truncate text-muted-foreground" :title="row.key">{{ row.key }}</dt>
      <dd class="font-mono break-words">{{ row.value }}</dd>
    </template>
  </dl>
</template>
