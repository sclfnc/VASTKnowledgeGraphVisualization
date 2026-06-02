// Per-panel front-end that combines filters + isolation + selection.
// When the panel is isolated it reads from its snapshot; otherwise it reads
// live state. Selection follows the live store unless the panel is isolated.
import { computed, toRef } from 'vue'
import { useFilteredModel } from './useFilteredModel.js'
import { injectGraphNodes } from './useGraphNodes.js'
import { useIsolationStore } from '@/stores/isolation.js'
import { useSelectionStore } from '@/stores/selection.js'
import { Bitset } from '@/utils/bitset.js'

// Shortcut: panels pass `props` instead of unpacking panelSpec.id + toRef(graphId).
export function usePanelContextFromProps(props) {
  return usePanelContext(props.panelSpec.id, toRef(props, 'graphId'))
}

export function usePanelContext(panelId, graphId) {
  const isolation = useIsolationStore()
  const selection = useSelectionStore()
  const live = useFilteredModel(graphId)
  const { nodes } = injectGraphNodes(graphId)

  const isolated = computed(() => isolation.isFrozen(panelId))

  const activeNodeMask = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.activeNodeMask ?? null
    }
    return live.activeNodeMask.value
  })

  const activeEdgeMask = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.activeEdgeMask ?? null
    }
    return live.activeEdgeMask.value
  })

  const selectedIds = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.selection ?? []
    }
    return selection.ids
  })

  const selectedEdgeIds = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.selectionEdges ?? []
    }
    return selection.edgeIds
  })

  const selectedMask = computed(() => {
    const soa = nodes.value
    if (!soa) return null
    const m = new Bitset(soa.N)
    for (const id of selectedIds.value) {
      const idx = soa.idToIdx.get(String(id))
      if (idx !== undefined) m.set(idx)
    }
    return m
  })

  // An edge id IS its SoA index (the /edges/ canonical walk), so we set the bit
  // directly — no idToIdx lookup. We don't know the total edge count here, so the
  // mask is sized to the highest selected id + 1; isEdgeSelected guards reads past
  // the end.
  const selectedEdgeMask = computed(() => {
    const ids = selectedEdgeIds.value
    if (!ids.length) return null
    let max = -1
    for (const id of ids) { const n = Number(id); if (n > max) max = n }
    const m = new Bitset(max + 1)
    for (const id of ids) {
      const n = Number(id)
      if (n >= 0) m.set(n)
    }
    return m
  })

  // Caption helpers — collapsed here so panels stop redefining them.
  // `edgeFilterActive`: an edge filter (type/weight/selfLoop) is narrowing the edge set.
  // `noNodesActive`: the node mask is empty — panels should render an empty-state caption.
  const edgeFilterActive = computed(() => {
    const m = activeEdgeMask.value
    if (!m) return false
    return m.popcount() < m.n
  })
  const noNodesActive = computed(() => activeNodeMask.value?.popcount() === 0)

  // Returns true when no mask is ready yet, so initial paint isn't dim.
  function isActive(id) {
    const m = activeNodeMask.value
    const soa = nodes.value
    if (!m || !soa) return true
    const idx = soa.idToIdx.get(String(id))
    if (idx === undefined) return true
    return m.get(idx)
  }

  // Same lenient default as isActive — out-of-range / missing edge_id reads as active
  // so initial paint isn't dim before /edges loads.
  function isEdgeActive(edgeId) {
    const m = activeEdgeMask.value
    if (!m || edgeId == null) return true
    if (edgeId < 0 || edgeId >= m.n) return true
    return m.get(edgeId)
  }

  // Canonical selection predicates — mirror isActive/isEdgeActive so panels stop
  // hand-rolling `selection.ids.includes(id)`. Empty selection → nothing selected
  // (returns false), unlike the active predicates whose empty default is true.
  function isSelected(id) {
    const m = selectedMask.value
    const soa = nodes.value
    if (!m || !soa) return false
    const idx = soa.idToIdx.get(String(id))
    if (idx === undefined) return false
    return m.get(idx)
  }

  function isEdgeSelected(edgeId) {
    const m = selectedEdgeMask.value
    if (!m || edgeId == null || edgeId < 0 || edgeId >= m.n) return false
    return m.get(edgeId)
  }

  return {
    activeNodeMask,
    activeEdgeMask,
    edgeFilterActive,
    noNodesActive,
    selectedIds,
    selectedEdgeIds,
    selectedMask,
    selectedEdgeMask,
    isActive,
    isEdgeActive,
    isSelected,
    isEdgeSelected,
    isolated,
  }
}
