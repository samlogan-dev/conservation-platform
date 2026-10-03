import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getPortalInfoAPI, getWindowFamilyAPI } from "@/apis/portalAPI";
import type { CorpusFamily } from "@/apis/corpusTypes";
import type { PortalInfo, PortalScope, PortalWindow } from "@/apis/portalTypes";

/**
 * The portal's selection: a species, a region and a window — never a run. The window lives
 * in the URL (`?window=`), so a view a practitioner is looking at can be bookmarked or sent
 * on; this store follows the URL rather than leading it.
 *
 * The family (every source for the window, newest run of each, and the joins between them)
 * is the same document the console's cross-source pages read, fetched by window instead.
 */
export const usePortalStore = defineStore("portalStore", () => {
  const info = ref<PortalInfo | null>(null);
  const windowId = ref<string | null>(null);
  const family = ref<CorpusFamily | null>(null);
  const loading = ref(false);
  const familyLoading = ref(false);
  const error = ref<string | null>(null);

  const scopes = computed(() => info.value?.scopes ?? []);
  const consoleEnabled = computed(() => info.value?.consoleEnabled ?? false);

  /** The scope holding the selected window, or the first scope when none is selected. */
  const scope = computed<PortalScope | null>(
    () =>
      scopes.value.find((s) => s.windows.some((w) => w.id === windowId.value)) ??
      scopes.value[0] ??
      null,
  );

  const currentWindow = computed<PortalWindow | null>(
    () => scope.value?.windows.find((w) => w.id === windowId.value) ?? null,
  );

  function describeError(e: unknown): string {
    const response = (e as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? (e instanceof Error ? e.message : String(e));
  }

  /**
   * The window a reader lands on: the most recent calendar year that has finished. A year
   * still in progress is one click away, but it is not the default, because its counts are
   * partial and read as a decline next to any full year.
   */
  function defaultWindow(s: PortalScope | null): string | null {
    if (!s) return null;
    return (s.windows.find((w) => w.calendarYear !== null && !w.inProgress) ?? s.windows[0])?.id ?? null;
  }

  /** Re-read on every visit, so a run harvested from the console shows up without a reload. */
  async function init() {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      info.value = await getPortalInfoAPI();
      if (scopes.value.length === 0) {
        error.value = "Nothing has been harvested yet, so there is nothing to report.";
      }
    } catch (e) {
      error.value = describeError(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Select a window by id; an unknown or missing id falls back to the default. Returns the id
   * used. `force` re-reads the family even when the window is unchanged.
   */
  async function selectWindow(id: string | null, force = false): Promise<string | null> {
    const known = id && scopes.value.some((s) => s.windows.some((w) => w.id === id));
    const next = known ? id : defaultWindow(scope.value);
    if (!force && next === windowId.value && family.value) return next;
    windowId.value = next;
    family.value = null;
    if (!next) return null;
    familyLoading.value = true;
    error.value = null;
    try {
      const f = await getWindowFamilyAPI(next);
      // A newer selection may have landed while this one loaded.
      if (windowId.value === next) family.value = f;
    } catch (e) {
      if (windowId.value === next) error.value = describeError(e);
    } finally {
      if (windowId.value === next) familyLoading.value = false;
    }
    return next;
  }

  /** The default window for another species and region. */
  function defaultWindowFor(speciesKey: string, regionKey: string): string | null {
    return defaultWindow(scopes.value.find((s) => s.speciesKey === speciesKey && s.regionKey === regionKey) ?? null);
  }

  return {
    info,
    scopes,
    scope,
    consoleEnabled,
    windowId,
    currentWindow,
    family,
    loading,
    familyLoading,
    error,
    init,
    selectWindow,
    defaultWindowFor,
  };
});
