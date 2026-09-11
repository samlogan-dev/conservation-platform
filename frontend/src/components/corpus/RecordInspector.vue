<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { RecordDetail, SchemaCheck, SchemaCheckStatus, SchemaResponse } from '@/apis/corpusTypes'
import { num, pct, preview } from '@/lib/format'

/**
 * One row of the sightings table, opened. The same record the grid shows in a line, laid out
 * by the schema's own groups with two kinds of check kept visually distinct:
 *
 *  - **Structural** (the badges): is the field present, and is it the declared type?
 *  - **Semantic** (the panel at the top): is the value sensible — a date not in the future, a
 *    point inside Australia?
 *
 * Expanding a field shows how the value got here — which source field it came from and what
 * the adapter did to it. `1736899200000 → 2025-01-15` and "the source never sent this" are
 * the facts that make a wrong value diagnosable, and neither is visible from the grid alone.
 */

const props = defineProps<{
  detail: RecordDetail
  schema: SchemaResponse
}>()

const emit = defineEmits<{ close: [] }>()

const collapsed = ref<Set<string>>(new Set())
const expandedField = ref<string | null>(null)
const hideEmpty = ref(false)

/** Schema checks for this record, keyed by field path. */
const checksByPath = computed(() => {
  const map = new Map<string, SchemaCheck>()
  for (const c of props.detail.schemaChecks) map.set(c.path, c)
  return map
})

const summary = computed(() => {
  const counts: Record<SchemaCheckStatus, number> = {
    ok: 0, empty: 0, missing_required: 0, type_mismatch: 0,
  }
  for (const c of props.detail.schemaChecks) counts[c.status]++
  return counts
})

const STATUS: Record<SchemaCheckStatus, { label: string; class: string; title: string }> = {
  ok: {
    label: 'ok',
    class: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    title: 'Present and the declared type',
  },
  empty: {
    label: 'empty',
    class: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    title: 'Not populated — the schema allows this field to be absent',
  },
  missing_required: {
    label: 'missing',
    class: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    title: 'Required by the schema and not present',
  },
  type_mismatch: {
    label: 'wrong type',
    class: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    title: 'Present but not the declared type',
  },
}

function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  next.has(key) ? next.delete(key) : next.add(key)
  collapsed.value = next
}

function fieldsFor(groupKey: string) {
  const group = props.schema.groups.find((g) => g.key === groupKey)
  if (!group) return []
  return hideEmpty.value
    ? group.fields.filter((f) => checksByPath.value.get(f.path)?.status !== 'empty')
    : group.fields
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <header class="border-b border-border px-4 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate font-mono text-sm">{{ detail.record.recordId }}</h2>
          <p class="mt-1 truncate text-xs text-muted-foreground">
            stored from <code class="font-mono">{{ detail.snapshotPage }}</code>
          </p>
        </div>
        <button
          class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close (Esc)"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          v-for="(count, status) in summary"
          :key="status"
          class="rounded px-1.5 py-0.5"
          :class="STATUS[status as SchemaCheckStatus].class"
          :title="STATUS[status as SchemaCheckStatus].title"
        >
          {{ count }} {{ STATUS[status as SchemaCheckStatus].label }}
        </span>
        <label class="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <input v-model="hideEmpty" type="checkbox" /> hide empty fields
        </label>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="detail.record.textWithheld"
        class="mx-4 mt-4 rounded border border-border bg-muted/40 p-3 text-xs"
      >
        <h3 class="font-semibold">Contributor text withheld</h3>
        <p class="mt-1 text-muted-foreground">{{ detail.record.textWithheldReason }}</p>
      </div>

      <!-- Semantic validation, distinct from the structural badges above -->
      <div
        v-if="detail.trace.validationIssues.length"
        class="mx-4 mt-4 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
      >
        <h3 class="text-xs font-semibold">Validation — does the value make sense?</h3>
        <ul class="mt-1 space-y-1 text-xs">
          <li v-for="issue in detail.trace.validationIssues" :key="issue.code">
            <span class="font-mono">{{ issue.code }}</span>
            <span class="text-muted-foreground"> — {{ issue.message }}</span>
          </li>
        </ul>
      </div>

      <!-- The record, by schema group -->
      <div class="space-y-2 p-4">
        <article v-for="group in schema.groups" :key="group.key" class="overflow-hidden rounded border border-border">
          <button
            class="flex w-full items-baseline justify-between gap-3 bg-muted/40 px-3 py-2 text-left hover:bg-muted"
            @click="toggleGroup(group.key)"
          >
            <span class="text-sm font-medium">
              {{ collapsed.has(group.key) ? '▸' : '▾' }} {{ group.label }}
            </span>
            <span class="shrink-0 text-[11px] text-muted-foreground">{{ group.fields.length }} fields</span>
          </button>

          <div v-if="!collapsed.has(group.key)">
            <p class="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {{ group.description }}
            </p>

            <div
              v-for="field in fieldsFor(group.key)"
              :key="field.path"
              class="border-b border-border last:border-b-0"
            >
              <button
                class="grid w-full grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-1.5 text-left hover:bg-muted/40"
                @click="expandedField = expandedField === field.path ? null : field.path"
              >
                <span class="min-w-0">
                  <span class="font-mono text-xs">{{ field.path.split('.').pop() }}</span>
                  <span v-if="field.required" class="ml-1 text-[10px] text-rose-600 dark:text-rose-400" title="required by the schema">•</span>
                  <span class="ml-2 font-mono text-xs text-muted-foreground">
                    <template v-if="checksByPath.get(field.path)?.value == null"><i>NULL</i></template>
                    <template v-else>{{ preview(checksByPath.get(field.path)?.value, 48) }}</template>
                  </span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <span class="font-mono text-[10px] text-muted-foreground">{{ field.type }}</span>
                  <span
                    v-if="checksByPath.get(field.path)"
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    :class="STATUS[checksByPath.get(field.path)!.status].class"
                    :title="STATUS[checksByPath.get(field.path)!.status].title"
                  >{{ STATUS[checksByPath.get(field.path)!.status].label }}</span>
                </span>
              </button>

              <!-- How this value got here -->
              <div v-if="expandedField === field.path" class="space-y-2 border-t border-border bg-muted/20 px-3 py-2 text-xs">
                <p class="text-muted-foreground">{{ field.description }}</p>

                <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                  <dt class="text-muted-foreground">Source field</dt>
                  <dd class="font-mono">{{ field.sourceFields?.join(', ') ?? '— derived internally' }}</dd>

                  <template v-if="field.sourceFields">
                    <dt class="text-muted-foreground">Raw value</dt>
                    <dd class="break-words font-mono">
                      <span v-if="detail.trace.fields.find((f) => f.canonicalField === field.path)?.redactionReason"
                            class="italic text-muted-foreground">[redacted]</span>
                      <span v-else-if="checksByPath.get(field.path)?.provenance?.status === 'absent_from_source'"
                            class="text-muted-foreground">the source did not send this field</span>
                      <span v-else>{{ preview(checksByPath.get(field.path)?.provenance?.rawValue, 90) }}</span>
                    </dd>

                    <dt class="text-muted-foreground">What happened</dt>
                    <dd>
                      <span class="font-mono">{{ checksByPath.get(field.path)?.provenance?.status?.replace(/_/g, ' ') ?? '—' }}</span>
                      <span v-if="checksByPath.get(field.path)?.provenance?.note" class="text-muted-foreground">
                        — {{ checksByPath.get(field.path)!.provenance!.note }}
                      </span>
                    </dd>
                  </template>

                  <dt class="text-muted-foreground">Across corpus</dt>
                  <dd>
                    <span class="font-mono">{{ pct(field.conformance.ok / Math.max(1, schema.totalRecords)) }}</span>
                    <span class="text-muted-foreground"> of {{ num(schema.totalRecords) }} records populate this field</span>
                    <span v-if="field.conformance.type_mismatch" class="text-amber-700 dark:text-amber-400">
                      · {{ num(field.conformance.type_mismatch) }} wrong type
                    </span>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
