<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { toneOf } from '@/lib/insights'

const props = defineProps<{ label: string | null; text?: string }>()
const tone = computed(() => toneOf(props.label))
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'alert' && 'bg-alert-soft text-alert',
      tone === 'good' && 'bg-good-soft text-good',
      tone === 'neutral' && 'bg-muted text-muted-foreground',
    )"
  >
    <slot>{{ text ?? label ?? 'not flagged' }}</slot>
  </span>
</template>
