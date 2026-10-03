<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { Table2 } from 'lucide-vue-next'
import { useCorpusStore } from '@/stores/corpusStore'
import { getRecordAPI, getSchemaAPI, listPagesAPI, listRecordsAPI, listTextRowsAPI } from '@/apis/corpusAPI'
import type {
  ClassifierKey,
  PagesResponse,
  RecordDetail,
  RecordList,
  RecordRow,
  SchemaResponse,
  SnapshotPageMeta,
  TextRow,
  TextRows,
} from '@/apis/corpusTypes'
import type { CellState, GridColumn } from '@/lib/grid'
import DataGrid from '@/components/corpus/DataGrid.vue'
import RecordInspector from '@/components/corpus/RecordInspector.vue'
import SourcePanel from '@/components/corpus/SourcePanel.vue'
import {
  excludedFieldsComment,
  harvestRunsDdl,
  sightingsDdl,
  snapshotPagesDdl,
  textClassificationsDdl,
} from '@/lib/ddl'
import { num } from '@/lib/format'

/**
 * Page 2 — the data as the database holds it.
 *
 * A table editor's view: one tab per table, one row per record, one column per field, with
 * the column's declared type in the header and NULL shown as NULL. `sightings` is the table
 * the pipeline exists to fill; `snapshot_pages` and `harvest_runs` are what its provenance
 * columns point at, so the chain back to page 1 is visible as foreign keys rather than as
 * prose.
 *
 * Structural problems are tinted in the grid itself (a required field that is missing, a
 * value of the wrong type). Opening a row shows the record by schema group with both kinds
 * of check and, per field, how the value got here. "Definition" swaps the grid for the DDL
 * the same schema declaration generates.
 */

const store = useCorpusStore()
const { harvestKey, runId, ready, harvests, analysis, manifest } = storeToRefs(store)

type TableKey = 'sightings' | 'text_classifications' | 'snapshot_pages' | 'harvest_runs'

const TABLES: { key: TableKey; description: string }[] = [
  {
    key: 'sightings',
    description:
      'One row per canonical record. Every source lands here in the same columns — that is what makes records from different sources comparable. Click a row to open it.',
  },
  {
    key: 'text_classifications',
    description:
      'One row per labelled remark: what a classifier says the free text states about the animal. text_classifications.recordId points at sightings. A claim, not a fact — the classifier, model and prompt version are on every row.',
  },
  {
    key: 'snapshot_pages',
    description:
      'One row per frozen API response — the bytes page 1 shows. sightings.snapshotPage points at file.',
  },
  {
    key: 'harvest_runs',
    description:
      'One row per harvest run, across every harvest. sightings.harvestId points at id. The run selected above is highlighted.',
  },
]

/** `?table=text_classifications` opens the page on that table. */
const route = useRoute()
const requestedTable = String(route.query.table ?? '')
const activeTable = ref<TableKey>(
  TABLES.some((t) => t.key === requestedTable) ? (requestedTable as TableKey) : 'sightings',
)
const mode = ref<'data' | 'definition'>('data')

const activeDescription = computed(
  () => TABLES.find((t) => t.key === activeTable.value)?.description ?? '',
)

// ---------------------------------------------------------------- sightings

const schema = ref<SchemaResponse | null>(null)
const list = ref<RecordList | null>(null)
const detail = ref<RecordDetail | null>(null)
const selectedId = ref<string | null>(null)
const search = ref('')
const invalidOnly = ref(false)
const dataResourceUid = ref('')
const offset = ref(0)
const limit = ref(100)
const listLoading = ref(false)

async function loadList() {
  if (!harvestKey.value || !runId.value) return
  listLoading.value = true
  try {
    list.value = await listRecordsAPI(harvestKey.value, runId.value, {
      limit: limit.value,
      offset: offset.value,
      search: search.value || undefined,
      dataResourceUid: dataResourceUid.value || undefined,
      invalidOnly: invalidOnly.value || undefined,
    })
  } finally {
    listLoading.value = false
  }
}

async function open(row: RecordRow) {
  if (!harvestKey.value || !runId.value) return
  selectedId.value = row.recordId
  detail.value = await getRecordAPI(harvestKey.value, runId.value, row.recordId)
}

function close() {
  selectedId.value = null
  detail.value = null
}

/** Column widths, in px. Anything not listed gets the default. */
const WIDTHS: Record<string, number> = {
  recordId: 250,
  'provenance.source': 90,
  'provenance.sourceRecordId': 250,
  'provenance.occurrenceId': 280,
  'provenance.harvestId': 300,
  'provenance.snapshotPage': 260,
  'provenance.fetchedAt': 180,
  'provenance.dataResourceUid': 130,
  'provenance.dataResourceName': 200,
  'provenance.license': 140,
  'provenance.contentRedistributable': 170,
  scientificName: 170,
  vernacularName: 130,
  eventDate: 180,
  decimalLatitude: 130,
  decimalLongitude: 130,
  coordinateUncertaintyInMeters: 220,
  locality: 240,
  basisOfRecord: 170,
  individualCount: 130,
  recordType: 170,
  recordedByPseudonym: 180,
  occurrenceRemarks: 320,
  eventRemarks: 240,
  sourceAssertions: 300,
  sourceQualityGrade: 160,
  isValid: 100,
}

const MONO = new Set([
  'recordId',
  'provenance.sourceRecordId',
  'provenance.occurrenceId',
  'provenance.harvestId',
  'provenance.snapshotPage',
  'provenance.dataResourceUid',
  'recordedByPseudonym',
])

/** The grid's columns are the schema's fields, in the schema's order and groups. */
const sightingColumns = computed<GridColumn[]>(() =>
  (schema.value?.groups ?? []).flatMap((group) =>
    group.fields.map((field) => ({
      key: field.path,
      label: field.path.split('.').pop()!,
      type: field.type,
      width: WIDTHS[field.path] ?? 150,
      required: field.required,
      primary: field.path === 'recordId',
      group: group.label,
      description: field.description,
      mono: MONO.has(field.path),
    })),
  ),
)

function sightingCellState(row: RecordRow, column: GridColumn): CellState | undefined {
  const problem = row.schemaProblems.find((p) => p.path === column.key)
  if (problem) {
    return problem.status === 'missing_required'
      ? { kind: 'missing', title: 'Required by the schema and not present' }
      : { kind: 'mismatch', title: 'Present but not the declared type' }
  }
  if (row.textWithheld && (column.key === 'occurrenceRemarks' || column.key === 'eventRemarks')) {
    return { kind: 'withheld', title: row.textWithheldReason ?? undefined }
  }
  if (row.coordinatesFuzzed && (column.key === 'decimalLatitude' || column.key === 'decimalLongitude')) {
    return {
      kind: 'fuzzed',
      title: `Rounded to about ${num(row.fuzzedToApproxMetres ?? 0)} m at the API boundary. The precise value is stored and never served.`,
    }
  }
  return undefined
}

/** Contributing datasets, for the filter. From the corpus analysis the store already holds. */
const datasets = computed(() =>
  (analysis.value?.resources ?? [])
    .filter((r) => r.dataResourceUid)
    .map((r) => ({ uid: r.dataResourceUid!, name: r.dataResourceName, records: r.records })),
)

// ---------------------------------------------------------------- text_classifications

const textRows = ref<TextRows | null>(null)
const textClassifier = ref<ClassifierKey | ''>('')
const textCondition = ref('')
const textEvent = ref('')
const textOffset = ref(0)
const textLoading = ref(false)

const CONDITION_OPTIONS = ['alive_healthy', 'alive_unwell', 'dead', 'unknown']
const EVENT_OPTIONS = ['vehicle_strike', 'dog_attack', 'disease', 'injury', 'fire', 'rescue_or_care', 'with_joey']

async function loadTextRows() {
  if (!harvestKey.value || !runId.value) return
  textLoading.value = true
  try {
    textRows.value = await listTextRowsAPI(harvestKey.value, runId.value, {
      classifier: textClassifier.value || undefined,
      condition: textCondition.value || undefined,
      event: textEvent.value || undefined,
      limit: limit.value,
      offset: textOffset.value,
    })
  } finally {
    textLoading.value = false
  }
}

const TEXT_COLUMNS: GridColumn[] = [
  { key: 'recordId', label: 'recordId', type: 'string', width: 250, required: true, primary: true, mono: true, group: 'Key', description: 'Which sighting the label is about. Foreign key to sightings.' },
  { key: 'field', label: 'field', type: 'string', width: 150, required: true, mono: true, group: 'Key', description: 'Which remark field was read.' },
  { key: 'classifier', label: 'classifier', type: 'string', width: 100, required: true, mono: true, group: 'Key', description: 'keyword baseline or llm.' },
  { key: 'subject', label: 'subject', type: 'string', width: 110, required: true, group: 'Label', description: 'Is the text about a koala at all.' },
  { key: 'condition', label: 'condition', type: 'string', width: 130, required: true, group: 'Label', description: 'The animal\'s state as the text states it.' },
  { key: 'events', label: 'events', type: 'string[]', width: 260, required: true, group: 'Label', description: 'Every event the text states. Empty is a valid answer.' },
  { key: 'confidence', label: 'confidence', type: 'number', width: 110, required: true, group: 'Label', description: 'The classifier\'s own certainty, 0 to 1. Rules report a fixed value.' },
  { key: 'evidence', label: 'evidence', type: 'string', width: 320, group: 'Label', description: 'A short quote from the remark supporting the label. Withheld wherever the remark itself is.' },
  { key: 'model', label: 'model', type: 'string', width: 170, mono: true, group: 'Provenance', description: 'Model id for llm rows; null for the keyword baseline.' },
  { key: 'promptVersion', label: 'promptVersion', type: 'string', width: 130, mono: true, group: 'Provenance', description: 'Prompt version the label was produced under.' },
  { key: 'dataResourceName', label: 'dataResourceName', type: 'string', width: 200, group: 'Sighting', description: 'The contributing dataset, from the sighting.' },
  { key: 'eventDate', label: 'eventDate', type: 'iso8601', width: 180, group: 'Sighting', description: 'When the sighting happened, from the sighting.' },
]

function textCellState(row: TextRow, column: GridColumn): CellState | undefined {
  if (column.key === 'evidence' && row.textWithheld) {
    return { kind: 'withheld', title: 'The licence does not permit redistribution of the remark, so its quote is withheld too. The label stands.' }
  }
  return undefined
}

// ---------------------------------------------------------------- paging (sightings and text rows)

/** Which table is paged, its total and its current offset. Null for the small tables. */
const paging = computed(() => {
  if (activeTable.value === 'sightings') {
    return { total: list.value?.total ?? 0, offset: offset.value, corpusTotal: list.value?.corpusTotal ?? null }
  }
  if (activeTable.value === 'text_classifications') {
    return { total: textRows.value?.total ?? 0, offset: textOffset.value, corpusTotal: null }
  }
  return null
})
const pageCount = computed(() => Math.max(1, Math.ceil((paging.value?.total ?? 0) / limit.value)))
const page = computed({
  get: () => Math.floor((paging.value?.offset ?? 0) / limit.value) + 1,
  set: (value: number) => {
    const clamped = Math.min(Math.max(1, Math.trunc(value) || 1), pageCount.value)
    const next = (clamped - 1) * limit.value
    if (activeTable.value === 'text_classifications') textOffset.value = next
    else offset.value = next
  },
})

function goToPage(event: Event) {
  page.value = Number((event.target as HTMLInputElement).value)
}

// ---------------------------------------------------------------- snapshot_pages

const pages = ref<PagesResponse | null>(null)

interface PageRow extends SnapshotPageMeta {
  harvestId: string
}

const pageRows = computed<PageRow[]>(() =>
  (pages.value?.slices ?? []).flatMap((slice) =>
    slice.pages.map((p) => ({ harvestId: `${harvestKey.value}/${runId.value}`, ...p })),
  ),
)

const PAGE_COLUMNS: GridColumn[] = [
  { key: 'file', label: 'file', type: 'string', width: 280, required: true, primary: true, mono: true, group: 'Key', description: 'Primary key with harvestId. What sightings.snapshotPage points at.' },
  { key: 'harvestId', label: 'harvestId', type: 'string', width: 300, required: true, mono: true, group: 'Key', description: 'Primary key with file. Which run this page belongs to.' },
  { key: 'sliceKey', label: 'sliceKey', type: 'string', width: 200, required: true, mono: true, group: 'Request', description: 'The date slice the harvester partitioned the window into.' },
  { key: 'startIndex', label: 'startIndex', type: 'integer', width: 110, required: true, group: 'Request', description: 'Offset into the slice this page starts at.' },
  { key: 'pageSize', label: 'pageSize', type: 'integer', width: 100, required: true, group: 'Request', description: 'Records asked for.' },
  { key: 'url', label: 'url', type: 'string', width: 460, required: true, mono: true, group: 'Request', description: 'The exact request, as sent.' },
  { key: 'status', label: 'status', type: 'integer', width: 90, required: true, group: 'Response', description: 'HTTP status.' },
  { key: 'recordCount', label: 'recordCount', type: 'integer', width: 120, required: true, group: 'Response', description: 'Records the page actually held.' },
  { key: 'bytes', label: 'bytes', type: 'integer', width: 110, required: true, group: 'Response', description: 'Size of the frozen body.' },
  { key: 'contentHash', label: 'contentHash', type: 'string', width: 220, required: true, mono: true, group: 'Response', description: 'sha256 of the bytes on disk. Re-fetching and hashing again is how a snapshot is verified.' },
  { key: 'fetchedAt', label: 'fetchedAt', type: 'iso8601', width: 180, required: true, group: 'Response', description: 'When the request was made.' },
  { key: 'durationMs', label: 'durationMs', type: 'integer', width: 110, required: true, group: 'Response', description: 'Round-trip time.' },
  { key: 'attempts', label: 'attempts', type: 'integer', width: 100, required: true, group: 'Response', description: 'More than one means a retry after a 429 or a server error.' },
]

// ---------------------------------------------------------------- harvest_runs

interface RunRow {
  id: string
  harvestKey: string
  source: string
  speciesKey: string
  regionKey: string
  startDate: string
  endDate: string
  startedAt: string
  expectedRecords: number
  retrievedRecords: number
  complete: boolean
  corpusHash: string
  warnings: number
}

const runRows = computed<RunRow[]>(() =>
  harvests.value.flatMap((h) =>
    h.runs.map((r) => ({
      id: `${h.key}/${r.runId}`,
      harvestKey: h.key,
      source: h.source,
      speciesKey: h.speciesKey,
      regionKey: h.regionKey,
      startDate: h.startDate,
      endDate: h.endDate,
      startedAt: r.startedAt,
      expectedRecords: r.expectedRecords,
      retrievedRecords: r.retrievedRecords,
      complete: r.complete,
      corpusHash: r.corpusHash,
      warnings: r.warnings,
    })),
  ),
)

const RUN_COLUMNS: GridColumn[] = [
  { key: 'id', label: 'id', type: 'string', width: 340, required: true, primary: true, mono: true, group: 'Key', description: '"<harvest key>/<run id>". What sightings.harvestId points at.' },
  { key: 'harvestKey', label: 'harvestKey', type: 'string', width: 200, required: true, mono: true, group: 'Query', description: 'The named query window this run executed.' },
  { key: 'source', label: 'source', type: 'string', width: 110, required: true, group: 'Query', description: 'Registry key of the source system.' },
  { key: 'speciesKey', label: 'speciesKey', type: 'string', width: 110, required: true, group: 'Query' },
  { key: 'regionKey', label: 'regionKey', type: 'string', width: 100, required: true, group: 'Query' },
  { key: 'startDate', label: 'startDate', type: 'iso8601', width: 120, required: true, group: 'Query', description: 'Inclusive start of the observation-date window.' },
  { key: 'endDate', label: 'endDate', type: 'iso8601', width: 120, required: true, group: 'Query', description: 'Inclusive end of the observation-date window.' },
  { key: 'startedAt', label: 'startedAt', type: 'iso8601', width: 180, required: true, group: 'Result', description: 'When the harvest began.' },
  { key: 'expectedRecords', label: 'expectedRecords', type: 'integer', width: 140, required: true, group: 'Result', description: 'What the source said the query held.' },
  { key: 'retrievedRecords', label: 'retrievedRecords', type: 'integer', width: 140, required: true, group: 'Result', description: 'What was actually fetched.' },
  { key: 'complete', label: 'complete', type: 'boolean', width: 100, required: true, group: 'Result', description: 'Expected and retrieved agree — the guard against reading a truncated harvest.' },
  { key: 'corpusHash', label: 'corpusHash', type: 'string', width: 220, required: true, mono: true, group: 'Result', description: 'sha256 over the page hashes, order-independent. Two runs with the same hash hold the same bytes.' },
  { key: 'warnings', label: 'warnings', type: 'integer', width: 100, required: true, group: 'Result' },
]

const currentRunKey = computed(() => `${harvestKey.value}/${runId.value}`)

// ---------------------------------------------------------------- definition

const ddlLines = computed<string[]>(() => {
  switch (activeTable.value) {
    case 'sightings':
      return schema.value
        ? [
            ...sightingsDdl(schema.value),
            ...excludedFieldsComment(manifest.value?.source ?? 'the source', analysis.value?.excludedSourceFields ?? []),
          ]
        : []
    case 'text_classifications':
      return textClassificationsDdl()
    case 'snapshot_pages':
      return snapshotPagesDdl()
    case 'harvest_runs':
      return harvestRunsDdl()
  }
})

/** Each DDL line split into code and trailing comment, so only the comment is muted. */
const ddl = computed(() =>
  ddlLines.value.map((line) => {
    const at = line.indexOf('-- ')
    return at === -1
      ? { code: line, comment: '' }
      : { code: line.slice(0, at), comment: line.slice(at) }
  }),
)

const activeRowCount = computed(() =>
  activeTable.value === 'snapshot_pages' ? pageRows.value.length : runRows.value.length,
)

// ---------------------------------------------------------------- wiring

watch(
  [harvestKey, runId],
  async () => {
    offset.value = 0
    textOffset.value = 0
    close()
    if (!harvestKey.value || !runId.value) return
    const [s, p] = await Promise.all([
      getSchemaAPI(harvestKey.value, runId.value),
      listPagesAPI(harvestKey.value, runId.value),
    ])
    schema.value = s
    pages.value = p
    void loadList()
    void loadTextRows()
  },
  { immediate: true },
)

watch([search, invalidOnly, dataResourceUid, limit], () => {
  offset.value = 0
  void loadList()
})
watch(offset, () => void loadList())

watch([textClassifier, textCondition, textEvent, limit], () => {
  textOffset.value = 0
  void loadTextRows()
})
watch(textOffset, () => void loadTextRows())

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const showInspector = computed(
  () => detail.value !== null && activeTable.value === 'sightings' && mode.value === 'data',
)
</script>

<template>
  <div v-if="ready" class="flex h-[calc(100vh-9.5rem)] min-h-0 flex-col">
    <!-- The selected source's essentials, collapsed until wanted -->
    <SourcePanel v-if="manifest && analysis" :manifest="manifest" :analysis="analysis" />

    <!-- Table tabs -->
    <div class="flex items-end gap-1 border-b border-border bg-muted/30 px-3 pt-2">
      <button
        v-for="t in TABLES"
        :key="t.key"
        class="-mb-px flex items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 font-mono text-xs"
        :class="activeTable === t.key
          ? 'border-border bg-background font-medium'
          : 'border-transparent text-muted-foreground hover:bg-muted'"
        @click="activeTable = t.key"
      >
        <Table2 class="h-3.5 w-3.5" />
        {{ t.key }}
      </button>
    </div>
    <p class="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
      {{ activeDescription }}
    </p>

    <!-- Toolbar -->
    <div
      v-if="activeTable === 'sightings' && mode === 'data'"
      class="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-xs"
    >
      <input
        v-model="search"
        type="search"
        placeholder="Filter by remarks, locality, identifiers…"
        class="w-72 max-w-full rounded border border-border bg-background px-2 py-1"
      />
      <select v-model="dataResourceUid" class="rounded border border-border bg-background px-1.5 py-1">
        <option value="">all datasets</option>
        <option v-for="d in datasets" :key="d.uid" :value="d.uid">
          {{ d.name }} ({{ num(d.records) }})
        </option>
      </select>
      <label class="flex items-center gap-1.5 text-muted-foreground">
        <input v-model="invalidOnly" type="checkbox" /> only rows with issues
      </label>
    </div>

    <div
      v-else-if="activeTable === 'text_classifications' && mode === 'data'"
      class="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-xs"
    >
      <select v-model="textClassifier" class="rounded border border-border bg-background px-1.5 py-1">
        <option value="">best available classifier</option>
        <option v-for="c in textRows?.available ?? []" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="textCondition" class="rounded border border-border bg-background px-1.5 py-1">
        <option value="">any condition</option>
        <option v-for="c in CONDITION_OPTIONS" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="textEvent" class="rounded border border-border bg-background px-1.5 py-1">
        <option value="">any event</option>
        <option v-for="e in EVENT_OPTIONS" :key="e" :value="e">{{ e }}</option>
      </select>
      <span v-if="textRows && textRows.available.length" class="ml-auto text-muted-foreground">
        labels from <span class="font-mono text-foreground">{{ textRows.classifier }}</span>
      </span>
    </div>

    <!-- Grid, with the inspector beside it when a row is open -->
    <div
      class="grid min-h-0 flex-1"
      :class="showInspector ? 'grid-cols-[minmax(0,1fr)_30rem]' : 'grid-cols-1'"
    >
      <div class="min-h-0 min-w-0">
        <div
          v-if="mode === 'definition'"
          class="h-full overflow-auto bg-[var(--code-bg)] p-4 font-mono text-[11.5px] leading-[18px]"
        >
          <div v-for="(line, i) in ddl" :key="i" class="whitespace-pre">{{ line.code }}<span class="ddl-comment">{{ line.comment }}</span>{{ line.code || line.comment ? '' : ' ' }}</div>
        </div>

        <DataGrid
          v-else-if="activeTable === 'sightings'"
          :columns="sightingColumns"
          :rows="list?.items ?? []"
          :row-key="(r: RecordRow) => r.recordId"
          :selected-key="selectedId"
          selectable
          :cell-state="sightingCellState"
          :start-index="offset"
          :loading="listLoading"
          empty-message="No rows match these filters."
          @select="open"
        />

        <DataGrid
          v-else-if="activeTable === 'text_classifications'"
          :columns="TEXT_COLUMNS"
          :rows="textRows?.items ?? []"
          :row-key="(r: TextRow) => `${r.recordId}:${r.field}`"
          :cell-state="textCellState"
          :start-index="textOffset"
          :loading="textLoading"
          empty-message="No classifier has labelled this run yet. From backend: npm run ingest -- classify <harvest> --classifier keyword"
        />

        <DataGrid
          v-else-if="activeTable === 'snapshot_pages'"
          :columns="PAGE_COLUMNS"
          :rows="pageRows"
          :row-key="(r: PageRow) => r.file"
        />

        <DataGrid
          v-else
          :columns="RUN_COLUMNS"
          :rows="runRows"
          :row-key="(r: RunRow) => r.id"
          :selected-key="currentRunKey"
        />
      </div>

      <aside v-if="showInspector" class="min-h-0 min-w-0 border-l border-border">
        <RecordInspector v-if="detail && schema" :detail="detail" :schema="schema" @close="close" />
      </aside>
    </div>

    <!-- Footer: paging and the Data / Definition switch -->
    <div class="flex flex-wrap items-center gap-3 border-t border-border px-3 py-1.5 text-xs">
      <template v-if="paging">
        <button class="pager" :disabled="page <= 1" @click="page--">‹</button>
        <span class="flex items-center gap-1.5 text-muted-foreground">
          Page
          <input
            type="number"
            min="1"
            :max="pageCount"
            :value="page"
            class="w-14 rounded border border-border bg-background px-1 py-0.5 text-center text-foreground"
            @change="goToPage"
          />
          of {{ num(pageCount) }}
        </span>
        <button class="pager" :disabled="page >= pageCount" @click="page++">›</button>

        <select v-model.number="limit" class="rounded border border-border bg-background px-1.5 py-0.5">
          <option :value="40">40 rows</option>
          <option :value="100">100 rows</option>
          <option :value="200">200 rows</option>
        </select>

        <span class="text-muted-foreground">
          {{ num(paging.total) }} records<template v-if="paging.corpusTotal !== null && paging.total !== paging.corpusTotal"> of {{ num(paging.corpusTotal) }}</template>
        </span>
      </template>
      <span v-else class="text-muted-foreground">{{ num(activeRowCount) }} records</span>

      <div class="ml-auto flex overflow-hidden rounded border border-border">
        <button
          class="px-2.5 py-0.5"
          :class="mode === 'data' ? 'bg-muted font-medium' : 'text-muted-foreground'"
          @click="mode = 'data'"
        >Data</button>
        <button
          class="border-l border-border px-2.5 py-0.5"
          :class="mode === 'definition' ? 'bg-muted font-medium' : 'text-muted-foreground'"
          @click="mode = 'definition'"
        >Definition</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pager {
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
}
.pager:disabled {
  opacity: 0.4;
}
.ddl-comment {
  color: var(--muted-foreground);
}
</style>
