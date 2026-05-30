// Debounced (300ms) ego subgraph fetcher; empty-state clears bypass the debounce.
// 422 detail lands in error.value verbatim so the panel renders the message as-is.
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
