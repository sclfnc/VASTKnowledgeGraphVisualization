// Global node-filter mask: bitwise OR over selected typeMasks + binsearch degree window + hideIsolated.
// Bit i set = node index i passes all global filters. Pin/Isolation are applied later in usePanelContext.
import { computed } from 'vue'
import { useFiltersStore } from '@/stores/filters.js'
import { useGraphNodes } from './useGraphNodes.js'
import { Bitset } from '@/utils/bitset.js'
import { lowerBound, upperBound } from '@/utils/binsearch.js'

export function useFilteredModel(graphId) {
  const filters = useFiltersStore()
  const { nodes } = useGraphNodes(graphId)

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

    return mask
  })

  return { activeNodeMask }
}
