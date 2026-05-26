// Global filter masks for nodes and edges. The chain is unidirectional —
// node mask is independent of edge filters; edge mask AND-s with node mask
// at the final step so an edge is "active" iff it passes all edge filters
// AND both its endpoints survive the node filters.
//
// Pin/Isolation are applied later in usePanelContext.
import { computed } from 'vue'
import { useFiltersStore } from '@/stores/filters.js'
import { useGraphNodes } from './useGraphNodes.js'
import { useGraphEdges } from './useGraphEdges.js'
import { Bitset } from '@/utils/bitset.js'
import { lowerBound, upperBound } from '@/utils/binsearch.js'

export function useFilteredModel(graphId) {
  const filters = useFiltersStore()
  const { nodes } = useGraphNodes(graphId)
  const { edges } = useGraphEdges(graphId)

  const activeNodeMask = computed(() => {
    const soa = nodes.value
    if (!soa) return null
    const { N, degrees, typeMasks } = soa

    const mask = new Bitset(N)
    const selectedTypes = filters.nodeTypes
    if (selectedTypes && selectedTypes.length > 0) {
      for (const t of selectedTypes) {
        const m = typeMasks.get(t)
        if (m) mask.orInPlace(m)
      }
    }

    const range = filters.degree?.value
    if (Array.isArray(range) && range.length === 2) {
      const [dMin, dMax] = range
      const hi = lowerBound(degrees, dMax, true)
      const lo = upperBound(degrees, dMin, true)
      for (let i = 0; i < hi; i++) mask.clear(i)
      for (let i = lo; i < N; i++) mask.clear(i)
    }

    if (filters.hideIsolated) {
      const firstZero = lowerBound(degrees, 0, true)
      for (let i = firstZero; i < N; i++) {
        if (degrees[i] === 0) mask.clear(i)
      }
    }

    if (filters.wccFilter && filters.wccFilter.length > 0) {
      const wccIds = soa.wccId
      if (wccIds) {
        const allowed = new Set(filters.wccFilter)
        for (let i = 0; i < N; i++) {
          if (!allowed.has(wccIds[i])) mask.clear(i)
        }
      }
    }

    return mask
  })

  const activeEdgeMask = computed(() => {
    const soa = edges.value
    if (!soa) return null
    const { E, source, target, weight, edgeTypes, typeMasks } = soa

    const mask = new Bitset(E)
    mask.setAll()

    // Step 1: edge type filter (OR of typeMasks for selected types)
    const selectedEdgeTypes = filters.edgeTypes
    if (selectedEdgeTypes && selectedEdgeTypes.length < edgeTypes.length) {
      const typeMask = new Bitset(E)
      for (const t of selectedEdgeTypes) {
        const m = typeMasks.get(t)
        if (m) typeMask.orInPlace(m)
      }
      mask.andInPlace(typeMask)
    }

    // Step 2: weight range filter (only on weighted graphs)
    // NaN comparisons return false in JS, so edges without weight survive the range filter.
    const weightRange = filters.weight?.value
    if (weight && Array.isArray(weightRange) && weightRange.length === 2) {
      const [wMin, wMax] = weightRange
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        const w = weight[i]
        if (w < wMin || w > wMax) mask.clear(i)
      }
    }

    // Step 3: self-loop filter
    if (filters.hideSelfLoops) {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        if (source[i] === target[i]) mask.clear(i)
      }
    }

    // Step 4: AND with node mask — edge active iff both endpoints survive
    const nodeMask = activeNodeMask.value
    if (nodeMask) {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        if (!nodeMask.get(source[i]) || !nodeMask.get(target[i])) mask.clear(i)
      }
    }

    return mask
  })

  return { activeNodeMask, activeEdgeMask }
}
