// Per-node inspector fetcher. Triggered by NodeInspector when the user focuses
// a single node via the cross-panel selection contract. No debounce — clicks
// are discrete user intents, not continuous streams.
import { watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function useNodeInspect(graphIdRef, nodeIdRef) {
  const { data, loading, error, run } = useFetch()

  function trigger() {
    const graphId = toValue(graphIdRef)
    const nodeId = toValue(nodeIdRef)
    if (!graphId || !nodeId) {
      data.value = null
      error.value = null
      return
    }
    run(apiUrl(`/node-inspect/${graphId}/${encodeURIComponent(nodeId)}`))
  }

  watch(
    () => [toValue(graphIdRef), toValue(nodeIdRef)],
    trigger,
    { immediate: true },
  )

  return { data, loading, error }
}
