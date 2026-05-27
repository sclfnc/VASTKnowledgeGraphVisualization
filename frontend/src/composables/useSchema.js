// Reactive schema fetch + cross-graph teardown (filters/selection/pins/isolation/history).
//
// MUST be called once at app root (currently GuideView) — the load() watcher
// triggers filter reset + filterHistory baseline + cross-graph teardown on
// every graphId change, so a duplicate instance would fire those side-effects
// twice. Consumers read the result via `injectSchema()`.
import { inject, watch } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { useGraphStore } from '../stores/graph.js'
import { useFiltersStore } from '../stores/filters.js'
import { useFilterHistoryStore } from '../stores/filterHistory.js'
import { useSelectionStore } from '../stores/selection.js'
import { usePinsStore } from '../stores/pins.js'
import { useIsolationStore } from '../stores/isolation.js'

const INJECT_KEY = 'schema'

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

    // If the graph has auto-promoted types, pre-fetch the effective labels
    // before filters.reset(). Otherwise filters.nodeTypes would be seeded
    // with the raw `Unknown` types (collapsing the chip group on Karate /
    // Davis) and the chip-bound AND-chain would mismatch the effective
    // list panels show.
    let effective = null
    if (result?.auto_promoted?.node || result?.auto_promoted?.edge) {
      try {
        const r = await fetch(apiUrl(`/effective-types/${id}`))
        if (r.ok) effective = await r.json()
      } catch (_e) {
        // Fall back to raw types — propagation still works, just less coherent.
      }
    }
    filters.reset(result, effective)
    // baseline() seeds history with the post-reset state and arms the $subscribe.
    filterHistory.baseline()
  }

  watch(() => graphStore.graphId, load, { immediate: true })

  return { schema, error }
}

// Read-only access to the schema provided by GuideView. Returns
// `{schema: Ref, error: Ref}` (same shape as useSchema). Falls back to a
// fresh instance only as a safety net for components mounted outside
// GuideView (DatasetView etc.).
export function injectSchema() {
  const provided = inject(INJECT_KEY, null)
  if (provided) return provided
  return useSchema()
}

export { INJECT_KEY as SCHEMA_KEY }
