// Debounced (300ms) ego subgraph fetcher; clearing to the empty state skips the debounce.
// On a 422 the backend detail lands in error.value unchanged, so the panel shows it as-is.
import { watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

const DEBOUNCE_MS = 300

export function useEgoSubgraph(egoIdRef, kRef, capRef, graphIdRef, directionRef = null) {
  const { data, loading, error, run } = useFetch()
  let timer = null

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null }
  }

  function scheduleFetch() {
    clearTimer()
    const graphId = toValue(graphIdRef)
    const egoId = toValue(egoIdRef)
    const k = toValue(kRef)
    const cap = toValue(capRef)
    const direction = toValue(directionRef) || 'out'

    if (!graphId || !egoId) {
      // Sync clear; empty state must render instantly.
      data.value = null
      error.value = null
      return
    }

    timer = setTimeout(() => {
      const path = `/ego/${graphId}/${encodeURIComponent(egoId)}?k=${k}&cap=${cap}&direction=${direction}`
      run(apiUrl(path))
    }, DEBOUNCE_MS)
  }

  watch(
    () => [toValue(graphIdRef), toValue(egoIdRef), toValue(kRef), toValue(capRef), toValue(directionRef)],
    scheduleFetch,
    { immediate: true },
  )

  return { data, loading, error }
}
