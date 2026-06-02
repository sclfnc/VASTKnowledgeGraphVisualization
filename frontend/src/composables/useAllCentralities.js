// Thin consumer for the Comparison panel: all four centralities + readiness flags.
import { computed, inject } from 'vue'

export function useAllCentralities() {
  const poller = inject('centralityPoller', null)
  const empty = {
    pagerank: computed(() => null),
    eigenvector: computed(() => null),
    betweenness: computed(() => null),
    closeness: computed(() => null),
    allReady: computed(() => false),
    anyError: computed(() => false),
    anyCancelled: computed(() => false),
    failedMeasures: computed(() => []),
    status: computed(() => ({ spectral: 'pending', betweenness: 'pending', closeness: 'pending' })),
  }
  if (!poller) return empty

  const status = computed(() => poller.status.value)

  const pagerank = computed(() => poller.data.value?.spectral?.pagerank ?? null)
  const eigenvector = computed(() => poller.data.value?.spectral?.eigenvector ?? null)
  const betweenness = computed(() => poller.data.value?.betweenness ?? null)
  const closeness = computed(() => poller.data.value?.closeness ?? null)

  const allReady = computed(() =>
    status.value.spectral === 'ready'
    && status.value.betweenness === 'ready'
    && status.value.closeness === 'ready'
  )
  const anyError = computed(() =>
    status.value.spectral === 'error'
    || status.value.betweenness === 'error'
    || status.value.closeness === 'error'
  )
  const anyCancelled = computed(() =>
    status.value.spectral === 'cancelled'
    || status.value.betweenness === 'cancelled'
    || status.value.closeness === 'cancelled'
  )
  // 'spectral' covers both PR and Eig — the user can't tell them apart at this layer.
  const failedMeasures = computed(() => {
    const out = []
    for (const k of ['spectral', 'betweenness', 'closeness']) {
      const s = status.value[k]
      if (s === 'error' || s === 'cancelled') out.push(k)
    }
    return out
  })

  return {
    pagerank, eigenvector, betweenness, closeness,
    allReady, anyError, anyCancelled, failedMeasures,
    status,
  }
}
