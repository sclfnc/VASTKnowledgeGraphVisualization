// Thin consumer of the global centrality poller; computed refs only, no network.
// `measure` ∈ {spectral_pagerank, spectral_eigenvector, betweenness, closeness}.
import { computed, inject } from 'vue'

const SUB_FIELD = {
  spectral_pagerank: 'pagerank',
  spectral_eigenvector: 'eigenvector',
}

const ENDPOINT_KEY = {
  spectral_pagerank: 'spectral',
  spectral_eigenvector: 'spectral',
  betweenness: 'betweenness',
  closeness: 'closeness',
}

export function useCentrality(measure) {
  const poller = inject('centralityPoller', null)
  if (!poller) {
    return {
      data: computed(() => null),
      status: computed(() => 'pending'),
      error: computed(() => null),
    }
  }
  const key = ENDPOINT_KEY[measure]
  const sub = SUB_FIELD[measure]
  const data = computed(() => {
    const raw = poller.data.value?.[key]
    if (!raw) return null
    return sub ? raw[sub] : raw
  })
  const status = computed(() => poller.status.value?.[key] ?? 'pending')
  const error = computed(() => poller.error.value?.[key] ?? null)
  return { data, status, error }
}
