<script setup lang="ts">
/** A bare proportion bar. No axis, no legend — it sits beside the number it describes. */
withDefaults(defineProps<{ value: number; tone?: 'default' | 'warn' }>(), { tone: 'default' })
</script>

<template>
  <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div
      class="h-full rounded-full transition-[width]"
      :class="tone === 'warn' ? 'bg-amber-500' : 'bg-foreground/70'"
      :style="{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }"
    />
  </div>
</template>
