// Reactive schema fetch + cross-graph teardown (filters/selection/pins/isolation/history).
import { watch } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { useGraphStore } from '../stores/graph.js'
import { useFiltersStore } from '../stores/filters.js'
import { useFilterHistoryStore } from '../stores/filterHistory.js'
import { useSelectionStore } from '../stores/selection.js'
import { usePinsStore } from '../stores/pins.js'
import { useIsolationStore } from '../stores/isolation.js'

export function useSchema() {
  const graphStore = useGraphStore()
  const filters = useFiltersStore()
  const filterHistory = useFilterHistoryStore()
  const selection = useSelectionStore()
  const pins = usePinsStore()
  const isolation = useIsolationStore()
  const { data: schema, error, run } = useFetch()

  // Wipe state referencing the previous graph's indices/ids/N-sized Bitsets.
  function tearDownCrossGraphState() {
    selection.clear()
    pins.clearAll()
    isolation.clearAll()
    filterHistory.clearAll()
  }

  async function load(id) {
    if (!id) {
      schema.value = null
      filters.reset(null)
      tearDownCrossGraphState()
      return
    }
    tearDownCrossGraphState()
    const result = await run(apiUrl(`/schema/${id}`))
    filters.reset(result)
    // baseline() seeds history with the post-reset state and arms the $subscribe.
    filterHistory.baseline()
  }

  watch(() => graphStore.graphId, load, { immediate: true })

  return { schema, error }
}
