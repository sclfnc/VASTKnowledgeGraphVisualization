// Stable edgeType → color mapping; mirror of useNodeTypeColors but on the edge
// side. Tableau10 + Set3 = ~22 distinct hues, enough for MC1's 12 edge types.
//
// Effective-type aware: when /effective-types/ exposes per-edge labels, the
// type list comes from there; otherwise falls back to `schema.edge_types`.
import { computed, toValue } from 'vue'
import * as d3 from 'd3'
import { injectEffectiveTypes } from './useEffectiveTypes.js'

const PALETTE = [
  // Tableau10 (10)
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
  '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab',
  // Set3 extension (12)
  '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
  '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
  '#ccebc5', '#ffed6f',
]

export function useEdgeTypeColors(schemaRef) {
  const { data: effData } = injectEffectiveTypes()

  const types = computed(() => {
    const labels = effData.value?.edge
    if (Array.isArray(labels) && labels.length) {
      const seen = new Set()
      for (const l of labels) seen.add(l)
      return [...seen].sort()
    }
    return toValue(schemaRef)?.edge_types ?? []
  })

  // Neutral slate fallback so panels never break on missing schema.
  // Fallback color is also used for type == 'Unknown'
  const color = d3.scaleOrdinal()
    .domain(types.value.filter(t => t !== 'Unknown'))
    .range(PALETTE)
    .unknown('#94a3b8')

  return { color, palette: PALETTE, types }
}
