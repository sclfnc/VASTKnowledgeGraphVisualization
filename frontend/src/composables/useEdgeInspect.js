// Per-edge inspector fetcher. Mirror of useNodeInspect but the path argument
// is the numeric edge_id from the /edges/ canonical walk.
import { watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function useEdgeInspect(graphIdRef, edgeIdRef) {
  const { data, loading, error, run } = useFetch()

  function trigger() {
    const graphId = toValue(graphIdRef)
    const edgeId = toValue(edgeIdRef)
    if (!graphId || edgeId === null || edgeId === undefined || edgeId === '') {
      data.value = null
      error.value = null
      return
    }
    run(apiUrl(`/edge-inspect/${graphId}/${encodeURIComponent(edgeId)}`))
  }

  watch(
    () => [toValue(graphIdRef), toValue(edgeIdRef)],
    trigger,
    { immediate: true },
  )

  return { data, loading, error }
}
