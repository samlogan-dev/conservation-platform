<script setup lang="ts">
import { computed } from 'vue'
import type { FieldStatus } from '@/apis/corpusTypes'

/**
 * The five mapping outcomes, colour-coded. The distinction that matters most is
 * absent_from_source vs empty_in_source: ALA omits unpopulated fields entirely, so "the
 * source never sent this" and "the source sent nothing" are different facts about the
 * publisher, and collapsing them would hide which one the corpus actually suffers from.
 */
const props = defineProps<{ status: FieldStatus }>()

const STYLES: Record<FieldStatus, { label: string; class: string; title: string }> = {
  mapped: {
    label: 'mapped',
    class: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    title: 'Carried across unchanged',
  },
  derived: {
    label: 'derived',
    class: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
    title: 'Transformed on the way in — units, epoch to ISO, array to scalar',
  },
  empty_in_source: {
    label: 'empty',
    class: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    title: 'The source carried the field but its value was empty',
  },
  absent_from_source: {
    label: 'absent',
    class: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    title: 'The source did not send this field at all',
  },
  rejected: {
    label: 'rejected',
    class: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    title: 'A value was present but could not be interpreted, so it did not reach the record',
  },
}

const style = computed(() => STYLES[props.status])
</script>

<template>
  <span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
    :class="style.class"
    :title="style.title"
  >{{ style.label }}</span>
</template>
