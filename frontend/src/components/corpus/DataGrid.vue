<script setup lang="ts" generic="Row extends object">
import { computed } from 'vue'
import { KeyRound, Maximize2 } from 'lucide-vue-next'
import type { CellState, GridColumn } from '@/lib/grid'

/**
 * A read-only database grid: one row per record, one column per field, in the style of a
 * table editor (Supabase, TablePlus). Header cells carry the column name and its declared
 * type; rows carry values with NULL shown as NULL rather than as a blank.
 *
 * Deliberately generic — it knows nothing about sightings. The caller supplies the columns
 * (usually derived from the schema), the rows, and an optional per-cell state so it can tint
 * a missing required value, mark withheld text, or flag a fuzzed coordinate.
 */

const props = withDefaults(
  defineProps<{
    columns: GridColumn[]
    rows: Row[]
    rowKey: (row: Row) => string
    selectedKey?: string | null
    /** Rows can be opened; the whole row is clickable and an expand icon appears on hover. */
    selectable?: boolean
    cellState?: (row: Row, column: GridColumn) => CellState | undefined
    /** Number shown against the first row, for paged tables. */
    startIndex?: number
    loading?: boolean
    emptyMessage?: string
  }>(),
  { selectedKey: null, selectable: false, startIndex: 0, loading: false, emptyMessage: 'No rows.' },
)

const emit = defineEmits<{ select: [row: Row] }>()

/** Width of the row-number column, which is also the left offset of a pinned primary key. */
const INDEX_WIDTH = 44

/**
 * A header has to fit its name and type on one line, so a column declared narrower than its
 * own header is widened. The per-character estimates are for the 12px UI font.
 */
const headerWidth = (c: GridColumn): number =>
  Math.ceil(
    c.label.length * 6.8 + c.type.length * 6.2 + 34 + (c.required ? 10 : 0) + (c.primary ? 18 : 0),
  )

const widths = computed(() => props.columns.map((c) => Math.max(c.width, headerWidth(c))))

const totalWidth = computed(() => INDEX_WIDTH + widths.value.reduce((sum, w) => sum + w, 0))

const groupStart = (index: number): boolean =>
  index === 0 || props.columns[index]!.group !== props.columns[index - 1]!.group

function read(row: Row, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), row)
}

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === ''

/** `2025-01-15T00:00:00.000Z` → `2025-01-15 00:00:00+00`; a bare date stays a bare date. */
function isoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/)
  if (!m) return iso
  if (!m[2]) return m[1]!
  return `${m[1]} ${m[2]}${iso.endsWith('Z') ? '+00' : ''}`
}

function format(value: unknown, type: string): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (type === 'iso8601' && typeof value === 'string') return isoDisplay(value)
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

interface Cell {
  text: string
  state: CellState | undefined
  empty: boolean
  title: string | undefined
}

function cell(row: Row, column: GridColumn): Cell {
  const value = read(row, column.key)
  const state = props.cellState?.(row, column)
  const empty = isEmpty(value)
  const text = empty ? 'NULL' : format(value, column.type)
  return {
    text,
    state,
    empty,
    title: state?.title ?? (text.length > 24 ? text : undefined),
  }
}

const cellClass = (c: Cell, column: GridColumn): string[] => {
  const classes: string[] = []
  if (column.mono || column.type !== 'string') classes.push('font-mono')
  if (c.state?.kind === 'missing') classes.push('cell-missing')
  else if (c.state?.kind === 'mismatch') classes.push('cell-mismatch')
  else if (c.state?.kind === 'withheld') classes.push('italic text-muted-foreground')
  else if (c.empty) classes.push('italic text-muted-foreground/70')
  return classes
}
</script>

<template>
  <div class="relative h-full min-h-0 overflow-auto">
    <table
      class="grid-table border-separate border-spacing-0 text-xs"
      :style="{ width: `${totalWidth}px`, minWidth: '100%', tableLayout: 'fixed' }"
    >
      <colgroup>
        <col :style="{ width: `${INDEX_WIDTH}px` }" />
        <col v-for="(c, i) in columns" :key="c.key" :style="{ width: `${widths[i]}px` }" />
      </colgroup>

      <thead class="sticky top-0 z-20">
        <tr>
          <th class="head-cell sticky left-0 z-30" />
          <th
            v-for="(c, i) in columns"
            :key="c.key"
            class="head-cell text-left font-normal"
            :class="[c.primary ? 'sticky z-30' : '', groupStart(i) ? 'group-start' : '']"
            :style="c.primary ? { left: `${INDEX_WIDTH}px` } : undefined"
            :title="c.description"
          >
            <div class="px-2 py-1">
              <div class="h-3 truncate text-[9px] uppercase tracking-wider text-muted-foreground/80">
                {{ groupStart(i) ? c.group : '' }}
              </div>
              <div class="flex items-center gap-1 truncate">
                <KeyRound v-if="c.primary" class="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                <span class="truncate font-medium">{{ c.label }}</span>
                <span
                  v-if="c.required && !c.primary"
                  class="shrink-0 text-rose-500"
                  title="required by the schema"
                >•</span>
                <span class="ml-1 shrink-0 text-muted-foreground">{{ c.type }}</span>
              </div>
            </div>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="(row, r) in rows"
          :key="rowKey(row)"
          class="group"
          :class="[selectable ? 'cursor-pointer' : '', rowKey(row) === selectedKey ? 'is-selected' : '']"
          @click="selectable && emit('select', row)"
        >
          <td class="body-cell sticky left-0 z-10 select-none text-center text-muted-foreground">
            <span v-if="selectable" class="hidden items-center justify-center group-hover:flex">
              <Maximize2 class="h-3 w-3" />
            </span>
            <span :class="selectable ? 'group-hover:hidden' : ''">{{ startIndex + r + 1 }}</span>
          </td>
          <td
            v-for="(c, i) in columns"
            :key="c.key"
            class="body-cell overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1.5"
            :class="[
              ...cellClass(cell(row, c), c),
              c.primary ? 'sticky z-10' : '',
              groupStart(i) ? 'group-start' : '',
            ]"
            :style="c.primary ? { left: `${INDEX_WIDTH}px` } : undefined"
            :title="cell(row, c).title"
          >
            <template v-if="cell(row, c).state?.kind === 'withheld'">withheld</template>
            <template v-else-if="cell(row, c).state?.kind === 'fuzzed'">
              <span class="text-muted-foreground">≈</span>{{ cell(row, c).text }}
            </template>
            <template v-else>{{ cell(row, c).text }}</template>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="loading" class="p-4 text-xs text-muted-foreground">Loading…</p>
    <p v-else-if="rows.length === 0" class="p-4 text-xs text-muted-foreground">{{ emptyMessage }}</p>
  </div>
</template>

<style scoped>
/*
 * Every cell paints its own background from a row-level variable, so the pinned columns stay
 * opaque while the rest of the row scrolls beneath them and still pick up hover/selection.
 */
.grid-table tbody tr {
  --row-bg: var(--background);
}
.grid-table tbody tr:hover {
  --row-bg: var(--muted);
}
.grid-table tbody tr.is-selected {
  --row-bg: var(--row-selected);
}
.head-cell {
  height: 2.5rem;
  background: var(--grid-header);
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.body-cell {
  background: var(--row-bg);
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
/* A slightly stronger rule where a schema group begins. */
.group-start {
  border-left: 2px solid color-mix(in oklch, var(--border), var(--foreground) 12%);
}
.cell-missing {
  background: color-mix(in oklch, var(--row-bg), oklch(0.6 0.22 20) 18%);
  color: oklch(0.45 0.2 20);
}
.cell-mismatch {
  background: color-mix(in oklch, var(--row-bg), oklch(0.8 0.18 80) 22%);
  color: oklch(0.45 0.15 70);
}
:global(.dark) .cell-missing {
  color: oklch(0.8 0.15 20);
}
:global(.dark) .cell-mismatch {
  color: oklch(0.85 0.15 80);
}
</style>
