import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  getAnalysisAPI,
  getFamilyAPI,
  getManifestAPI,
  listHarvestsAPI,
} from "@/apis/corpusAPI";
import type { Analysis, CorpusFamily, Harvest, Manifest } from "@/apis/corpusTypes";

/**
 * Holds the currently selected run and the documents every view needs: the manifest (how this
 * run was collected), the analysis (what is in it), and the family — every source fetched for
 * the same species, region and window, which the cross-source pages read instead of the
 * selected run. Records are fetched per-view, since the record list is paged and filtered
 * independently.
 */
export const useCorpusStore = defineStore("corpusStore", () => {
  const harvests = ref<Harvest[]>([]);
  const harvestKey = ref<string | null>(null);
  const runId = ref<string | null>(null);
  const manifest = ref<Manifest | null>(null);
  const analysis = ref<Analysis | null>(null);
  const family = ref<CorpusFamily | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const selectedHarvest = computed(() =>
    harvests.value.find((h) => h.key === harvestKey.value) ?? null,
  );

  const comparisons = computed(() => family.value?.comparisons ?? []);

  const ready = computed(() => harvestKey.value !== null && runId.value !== null);

  function describeError(e: unknown): string {
    const response = (e as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? (e instanceof Error ? e.message : String(e));
  }

  /** Load the harvest list and select the newest run of the first harvest that has one. */
  async function init() {
    loading.value = true;
    error.value = null;
    try {
      harvests.value = await listHarvestsAPI();
      const firstWithRun = harvests.value.find((h) => h.runs.length > 0);
      if (firstWithRun) {
        await selectRun(firstWithRun.key, firstWithRun.runs[0]!.runId);
      } else {
        error.value =
          "No harvested runs found. Run `npm run ingest -- harvest` in platform/backend first.";
      }
    } catch (e) {
      error.value = describeError(e);
    } finally {
      loading.value = false;
    }
  }

  async function selectRun(key: string, run: string) {
    loading.value = true;
    error.value = null;
    harvestKey.value = key;
    runId.value = run;
    try {
      const [m, a, f] = await Promise.all([
        getManifestAPI(key, run),
        getAnalysisAPI(key, run),
        getFamilyAPI(key, run),
      ]);
      manifest.value = m;
      analysis.value = a;
      family.value = f;
    } catch (e) {
      error.value = describeError(e);
      manifest.value = null;
      analysis.value = null;
      family.value = null;
    } finally {
      loading.value = false;
    }
  }

  return {
    harvests,
    harvestKey,
    runId,
    manifest,
    analysis,
    family,
    comparisons,
    loading,
    error,
    ready,
    selectedHarvest,
    init,
    selectRun,
  };
});
