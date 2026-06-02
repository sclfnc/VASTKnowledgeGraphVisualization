// Single global poller for centrality status + data; created once in GuideView and
// provided to descendants. Polls /centrality-status every POLL_MS until every measure
// reaches a final state (ready, error, or cancelled). Each time a measure turns 'ready'
// it fires one data fetch. Resets on graphId change, stops on 404.
import { ref, watch, toValue, onBeforeUnmount } from 'vue'
import { apiUrl } from './useApi.js'

const POLL_MS = 2000
const MEASURES = ['spectral', 'betweenness', 'closeness']
const TERMINAL = new Set(['ready', 'error', 'cancelled'])

function initialMap(fallback = null) {
  return { spectral: fallback, betweenness: fallback, closeness: fallback }
}

export function useCentralityPoller(graphIdRef) {
  const status = ref(initialMap('pending'))
  const data = ref(initialMap(null))
  const error = ref(initialMap(null))

  let timer = null
  let aborter = null
  let activeGraphId = null

  function reset() {
    status.value = initialMap('pending')
    data.value = initialMap(null)
    error.value = initialMap(null)
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  function abortInFlight() {
    if (aborter) { aborter.abort(); aborter = null }
  }

  async function fetchMeasureData(id, measure) {
    try {
      const res = await fetch(apiUrl(`/centrality/${measure}/${id}`), { signal: aborter?.signal })
      // We only call after status flipped to 'ready', so 202 shouldn't appear here.
      if (!res.ok) {
        if (id !== activeGraphId) return
        // Surface the error so the UI can show "ready but no data" diagnostic
        // instead of a permanent silent empty state.
        error.value = { ...error.value, [measure]: `HTTP ${res.status}` }
        return
      }
      const payload = await res.json()
      if (id !== activeGraphId) return  // graph switched mid-flight
      data.value = { ...data.value, [measure]: payload?.data ?? null }
    } catch (e) {
      if (e.name === 'AbortError') return
      error.value = { ...error.value, [measure]: e.message ?? 'fetch failed' }
    }
  }

  async function pollOnce(id) {
    try {
      const res = await fetch(apiUrl(`/centrality-status/${id}`), { signal: aborter?.signal })
      if (res.status === 404) { stopTimer(); return }
      if (!res.ok) return
      const next = await res.json()
      if (id !== activeGraphId) return

      // Each time a measure turns 'ready' we fire a single data fetch.
      const prev = status.value
      const flips = MEASURES.filter(m => next[m] === 'ready' && prev[m] !== 'ready')
      status.value = { ...prev, ...next }

      for (const m of flips) fetchMeasureData(id, m)

      if (MEASURES.every(m => TERMINAL.has(status.value[m]))) stopTimer()
    } catch (e) {
      if (e.name === 'AbortError') return
      // Network blip — interval will retry on the next tick.
    }
  }

  function start(id) {
    stopTimer()
    abortInFlight()
    activeGraphId = id
    if (!id) { reset(); return }
    reset()
    aborter = new AbortController()
    pollOnce(id)
    timer = setInterval(() => pollOnce(id), POLL_MS)
  }

  watch(() => toValue(graphIdRef), (id) => { start(id) }, { immediate: true })

  onBeforeUnmount(() => {
    stopTimer()
    abortInFlight()
  })

  return { status, data, error }
}
