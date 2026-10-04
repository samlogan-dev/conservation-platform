import { ref, watch, type WatchSource } from 'vue'

/** Load data, re-running when any source changes; exposes loading and error for AsyncState. */
export function useAsync<T>(load: () => Promise<T>, sources: WatchSource[] = []) {
  const data = ref<T | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)
  let call = 0
  const run = async () => {
    const mine = ++call
    loading.value = true
    error.value = null
    try {
      const result = await load()
      if (mine === call) data.value = result
    } catch (e: any) {
      if (mine === call) error.value = e?.response?.data?.error ?? e?.message ?? String(e)
    } finally {
      if (mine === call) loading.value = false
    }
  }
  watch(sources, run, { immediate: true })
  return { data, loading, error, reload: run }
}
