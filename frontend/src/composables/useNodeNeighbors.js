// Paginated neighbor list fetcher (/node-neighbors/). Keeps a local buffer of
// already-loaded items and exposes loadMore() for the inspector's infinite-
// scroll panel. Switching node id or direction resets the buffer.
import { ref, watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'

const PAGE_SIZE = 50

export function useNodeNeighbors(graphIdRef, nodeIdRef, directionRef) {
  const items = ref([])
  const filteredTotal = ref(0)
  const total = ref(0)
  const loading = ref(false)
  const error = ref(null)
  const done = ref(false)

  let abortCtrl = null
  let reqGen = 0

  async function fetchPage(offset) {
    const graphId = toValue(graphIdRef)
    const nodeId = toValue(nodeIdRef)
    const direction = toValue(directionRef) || 'all'
    if (!graphId || !nodeId) return

    const myGen = ++reqGen
    if (abortCtrl) abortCtrl.abort()
    abortCtrl = new AbortController()
    loading.value = true
    error.value = null
    try {
      const url = apiUrl(
        `/node-neighbors/${graphId}/${encodeURIComponent(nodeId)}` +
        `?offset=${offset}&limit=${PAGE_SIZE}&direction=${direction}`,
      )
      const res = await fetch(url, { signal: abortCtrl.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      const payload = await res.json()
      if (myGen !== reqGen) return  // a newer request superseded us
      if (offset === 0) {
        items.value = payload.items
      } else {
        // Append: backend dedup already applied at the (other, direction[, eid]) level.
        items.value = items.value.concat(payload.items)
      }
      filteredTotal.value = payload.filtered_total
      total.value = payload.total
      done.value = items.value.length >= filteredTotal.value
    } catch (e) {
      if (e.name === 'AbortError') return
      if (myGen !== reqGen) return
      error.value = e
    } finally {
      if (myGen === reqGen) loading.value = false
    }
  }

  function reset() {
    items.value = []
    filteredTotal.value = 0
    total.value = 0
    done.value = false
    error.value = null
  }

  function loadMore() {
    if (loading.value || done.value) return
    fetchPage(items.value.length)
  }

  // Refetch from scratch whenever the keys change.
  watch(
    () => [toValue(graphIdRef), toValue(nodeIdRef), toValue(directionRef)],
    () => {
      reset()
      const nodeId = toValue(nodeIdRef)
      const graphId = toValue(graphIdRef)
      if (nodeId && graphId) fetchPage(0)
    },
    { immediate: true },
  )

  return { items, total, filteredTotal, loading, error, done, loadMore }
}
