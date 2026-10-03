<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { usePortalStore } from '@/stores/portalStore'
import { getWindowSynthesisAPI } from '@/apis/portalAPI'
import type { SynthesisStatus } from '@/apis/corpusTypes'
import SynthesisReport from '@/components/shared/SynthesisReport.vue'
import { windowLabel } from '@/lib/windows'

/**
 * AI analysis, portal side — the model's checked reading of the window, read-only.
 *
 * The portal never calls a model. An analysis is generated from the console, stored against
 * the window, and shown here with the evidence it was given and every place its prose said
 * something that evidence did not contain. Where the window's numbers have changed since it
 * was generated, the page says so rather than presenting it as current.
 */

const store = usePortalStore()
const { windowId, currentWindow, consoleEnabled } = storeToRefs(store)

const status = ref<SynthesisStatus | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

watch(
  windowId,
  async (id) => {
    if (!id) return
    loading.value = true
    error.value = null
    try {
      const s = await getWindowSynthesisAPI(id)
      if (windowId.value === id) status.value = s
    } catch (e) {
      const response = (e as { response?: { data?: { message?: string } } }).response
      error.value = response?.data?.message ?? (e instanceof Error ? e.message : String(e))
      status.value = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

/** The console page that generates an analysis for this window, opened on its first source's run. */
const generateLink = computed(() => {
  const m = currentWindow.value?.members[0]
  return m ? { path: '/console/analysis', query: { harvest: m.harvestKey, run: m.runId } } : null
})
</script>

<template>
  <div class="space-y-6 p-6">
    <p class="max-w-3xl text-xs text-muted-foreground">
      What a language model finds most worth knowing in this window's numbers. It was given the
      window's figures — per source, and the comparisons between sources — and nothing else: no
      record, no remark, no coordinate. Every metric it cites and every number in its prose was
      checked against those figures before it was stored. Anything that failed the check is
      marked in red.
    </p>

    <p v-if="loading && !status" class="text-sm text-muted-foreground">Loading…</p>

    <div v-if="error" class="rounded border border-rose-300 bg-rose-50 p-4 text-xs dark:border-rose-900 dark:bg-rose-950/40">
      <p class="font-medium">The analysis could not be loaded.</p>
      <p class="mt-1">{{ error }}</p>
    </div>

    <template v-if="status">
      <p
        v-if="status.synthesis && status.stale"
        class="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      >
        ⚠ This window's numbers have changed since the analysis was generated (a new run, or a new
        classifier pass). Read it as a view of the earlier numbers, not the current ones.
      </p>

      <div v-if="!status.synthesis" class="rounded border border-border p-5 text-sm">
        <p>No AI analysis has been generated for {{ currentWindow ? windowLabel(currentWindow) : 'this window' }} yet.</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Analyses are generated from the console, one model call per window, and appear here once
          they have been checked.
          <RouterLink v-if="consoleEnabled && generateLink" :to="generateLink" class="underline">Generate one in the console</RouterLink>
        </p>
      </div>

      <SynthesisReport :status="status" />
    </template>
  </div>
</template>
