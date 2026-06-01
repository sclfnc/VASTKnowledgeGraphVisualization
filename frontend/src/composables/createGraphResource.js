// Factory (not a composable). `createGraphResource('metrics')` → composable returning {data, loading, error}.
// Pass `query(id) → string|null` for endpoints with extra reactive state (e.g. timeline overrides).
import { watch, toValue, computed } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function createGraphResource(path, options = {}) {
  const { query = null } = options
  return function useGraphResource(graphId) {
    const { data, loading, error, run } = useFetch()
    const queryRef = computed(() => (query ? query(toValue(graphId)) : null))

    async function load() {
      const id = toValue(graphId)
      if (!id) { data.value = null; return }
      const qs = queryRef.value
      await run(apiUrl(`/${path}/${id}`) + (qs ? `?${qs}` : ''))
    }

    watch([() => toValue(graphId), queryRef], load, { immediate: true })
    return { data, loading, error }
  }
}
