// Single entry point for the "Filter to this …" panel buttons. Centralises
// the write paths into `filters.*` so call sites don't repeat the same
// one-liners with subtle differences.
//
// Consumers today: graph_status_inspector (filterToNodeType / filterToComponent),
// connectivity (filterToComponent / filterToWccTopN / clearWccFilter +
// isolateSelected), type_mixing (filterToNodeTypes via a cell selection),
// edge_flow (filterToEdgeType / filterToNodeType via meta-node selection).
//
// Side-effect-free wrappers — no fetches, no watchers. Pure mutation helpers
// over the Pinia filters store.
import { useFiltersStore } from '@/stores/filters.js'

export function useFilterShortcuts() {
  const filters = useFiltersStore()

  function filterToNodeType(type) {
    filters.nodeTypes = [type]
  }
  function filterToNodeTypes(types) {
    filters.nodeTypes = [...new Set(types)]
  }
  function filterToEdgeType(type) {
    filters.edgeTypes = [type]
  }
  function filterToEdgeTypes(types) {
    filters.edgeTypes = [...new Set(types)]
  }

  // Component filter writes the scoped slot { scope, ids }. scope defaults to
  // 'wcc' so every existing WCC caller is unchanged; connectivity passes 'scc'
  // in SCC mode so useFilteredModel resolves the ids against soa.sccId.
  function filterToComponent(componentId, scope = 'wcc') {
    filters.wccFilter = { scope, ids: [componentId] }
  }
  function filterToComponents(ids, scope = 'wcc') {
    filters.wccFilter = { scope, ids: [...new Set(ids)] }
  }
  function filterToWccTopN(n) {
    filters.wccFilter = { scope: 'wcc', ids: Array.from({ length: n }, (_, i) => i) }
  }
  function clearWccFilter() {
    filters.wccFilter = null
  }

  // Used by ConnectedComponents' "Isolate selected": maps a set of node ids
  // through (id → idx → wcc_id) and writes the unique component ids (WCC scope).
  function filterToWccOfNodes(nodeIds, soaNodes) {
    if (!soaNodes?.wccId || !soaNodes?.idToIdx) return
    const seen = new Set()
    for (const id of nodeIds) {
      const idx = soaNodes.idToIdx.get(String(id))
      if (idx == null) continue
      const cid = soaNodes.wccId[idx]
      if (cid >= 0) seen.add(cid)
    }
    filters.wccFilter = { scope: 'wcc', ids: [...seen].sort((a, b) => a - b) }
  }

  return {
    filterToNodeType, filterToNodeTypes,
    filterToEdgeType, filterToEdgeTypes,
    filterToComponent, filterToComponents,
    filterToWccTopN, clearWccFilter,
    filterToWccOfNodes,
  }
}
